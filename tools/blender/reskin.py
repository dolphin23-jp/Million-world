"""
Blender (bpy) でスキンウェイトを作り直す / 平滑化する。

  python3 tools/blender/reskin.py <in.glb> <out.glb> --mode heat|smooth [--keep-anim]

- heat   : 既存ウェイトを捨て、Blender の自動ウェイト（ボーンヒート拡散）で付け直す
- smooth : 既存ウェイトを平滑化し、1 頂点 4 ボーンに制限して正規化する
入力は Meshy の 3d_rigging 出力（Armature + スキンメッシュ + クリップ 1 本）を想定。
"""
import sys
import argparse

import bpy


def fix_bone_tails(arm) -> None:
    """glTF にはボーンの尾が無く、インポータが推定した長さが極端になる。ヒートウェイトはボーン線分を使うので、
    子の頭に向けて付け直す（葉は親方向の延長で短く）。"""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in eb:
        children = [c for c in b.children]
        head = b.head.copy()
        if children:
            tail = sum((c.head for c in children), head * 0).copy() / len(children)
            if (tail - head).length < 1e-3:
                tail = head + (b.tail - b.head).normalized() * max(0.02 * 100, 1e-2)
        else:
            d = (head - b.parent.head) if b.parent else (b.tail - b.head)
            if d.length < 1e-6:
                d = (b.tail - b.head)
            tail = head + d.normalized() * max(d.length * 0.4, 1.0)
        b.tail = tail
        b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    lens = [round(b.length, 2) for b in arm.data.bones]
    print(f"[reskin] bone lengths: min={min(lens)} max={max(lens)}")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--mode", choices=["heat", "smooth"], default="heat")
    ap.add_argument("--keep-anim", action="store_true")
    ap.add_argument("--smooth-factor", type=float, default=0.5)
    ap.add_argument("--smooth-repeat", type=int, default=2)
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    # merge_vertices: UV シームや法線で分かれた頂点を結合して連結メッシュにする（UV は面コーナーごとに保持される）
    bpy.ops.import_scene.gltf(filepath=args.inp, merge_vertices=True)

    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    # Meshy が付けてくる Icosphere 等の余計なメッシュを捨てる
    for o in list(bpy.data.objects):
        if o.type == "MESH" and ("icosphere" in o.name.lower()):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    fix_bone_tails(arm)
    if not meshes:
        raise SystemExit("メッシュがありません")
    print(f"[reskin] armature={arm.name} bones={len(arm.data.bones)} meshes={[m.name for m in meshes]}")

    # 評価はレスト姿勢で行う（アニメが入っていても bind で計算する）
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    for mesh in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        if args.mode == "heat":
            # 既存のウェイトと Armature モディファイアを捨てる
            mesh.vertex_groups.clear()
            for mod in list(mesh.modifiers):
                if mod.type == "ARMATURE":
                    mesh.modifiers.remove(mod)
            # 親子関係を解除（変換は保持）
            bpy.context.view_layer.objects.active = mesh
            mesh.select_set(True)
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
            bpy.ops.object.select_all(action="DESELECT")
            mesh.select_set(True)
            arm.select_set(True)
            bpy.context.view_layer.objects.active = arm
            # ヒートウェイト。非多様体で失敗する場合は例外ではなく警告が出るので、結果のグループ数で判定する
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
            n_groups = len(mesh.vertex_groups)
            n_unweighted = sum(1 for v in mesh.data.vertices if not v.groups)
            print(f"[reskin] heat: groups={n_groups} unweighted_vertices={n_unweighted}/{len(mesh.data.vertices)}")
            if n_groups == 0:
                raise SystemExit("自動ウェイトに失敗しました（頂点グループが 0）")
        else:
            bpy.context.view_layer.objects.active = mesh
            mesh.select_set(True)

        # 後処理: 平滑化 → 4 本制限 → 正規化（heat でも軽く掛けると関節が滑らかになる）
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
        try:
            bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=args.smooth_factor, repeat=args.smooth_repeat, expand=0.0)
        except Exception as e:  # noqa: BLE001
            print(f"[reskin] smooth skipped: {e}")
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        bpy.ops.object.mode_set(mode="OBJECT")

    arm.data.pose_position = "POSE"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_animations=args.keep_anim,
        export_skins=True,
        export_yup=True,
        export_apply=False,
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_def_bones=False,
        export_all_influences=False,
    )
    print(f"[reskin] wrote {args.out}")


if __name__ == "__main__":
    main()
