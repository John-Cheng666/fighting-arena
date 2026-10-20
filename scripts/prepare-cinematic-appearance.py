"""Read the exact approved SF6 appearance resources; never run or modify the game."""
from pathlib import Path
import hashlib
import json
import struct
import sys
import zlib

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parent.parent
RESEARCH = Path(r"C:\Users\ASUS\Desktop\fighting-arena")
OUT = RESEARCH / ".local/sf6-v3/appearance"
sys.path.insert(0, str(RESEARCH / "research/sf6-ai/fidelity"))
from extract_jamie_ai import GAME, MAX_INDEX, MAX_PAYLOAD, resource_hash, zstd_decompress

RESOURCES = [
    "natives/stm/product/charparam/esf/esf021/timeline/btlc_esf021.user.2",
    "natives/stm/product/charparam/esf/esf021/timeline/esf021_mpm.user.2",
    *[f"natives/stm/product/charparam/esf/esf021/battle_ud/esf021v{n:02}_model_parts.user.2" for n in range(4)],
    "natives/stm/product/event/fgm/esf/esf021/clip/esf021_003_00.tml.53002",
    "natives/stm/product/event/fgm/esf/esf021/clip/esf021_003_01.tml.53002",
    "natives/stm/product/event/fgm/esf/esf021/clip/esf021_003_02.clip.53",
    "natives/stm/product/event/fgm/esf/esf021/clip/esf021_004_11.tml.53002",
    "natives/stm/product/event/fgm/esf/esf021/clip/esf021_004_12.clip.53",
    "natives/stm/product/model/esf/esf021/001/esf021_001_cmd_000.user.2",
    "natives/stm/product/model/esf/esf021/001/esf021_001_cmd_001.user.2",
    "natives/stm/product/model/esf/esf021/001/esf021_001_shape.user.2",
    "natives/stm/product/charparam/esf/esf021/esf021v00.scn.20",
    "natives/stm/product/charparam/esf/esf021/prefab/esf021v00.pfb.17",
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def extract():
    entries = []
    cached = OUT / "extraction.json"
    if cached.exists():
        for entry in json.loads(cached.read_text(encoding="utf-8"))["entries"]:
            output = Path(entry["output"])
            if entry["resource"] in RESOURCES and output.exists() and sha(output.read_bytes()) == entry["sha256"]:
                entries.append(entry)
    retained = {entry["resource"] for entry in entries}
    targets = {resource_hash(p): p for p in RESOURCES if p not in retained}
    if not targets:
        return json.loads(cached.read_text(encoding="utf-8"))
    archives = list(GAME.glob("*.pak*"))
    for folder in [GAME / "dlc", GAME / "pdlc"]:
        if folder.exists():
            archives.extend(folder.rglob("*.pak*"))
    archive_reports = []
    for archive in sorted(set(archives)):
        with archive.open("rb") as stream:
            header = stream.read(16)
            magic, major, minor, flags, count, fingerprint = struct.unpack("<IBBHII", header)
            if magic != 0x414B504B or major != 4 or flags or count * 48 > MAX_INDEX:
                raise ValueError(f"Unsupported bounded PAK directory: {archive}")
            index = stream.read(count * 48)
            archive_reports.append({"path": str(archive), "indexSha256": sha(index), "fileCount": count})
            for row, values in enumerate(struct.iter_unpack("<IIQQQQQ", index)):
                lower, upper, offset, packed_size, size, attributes, checksum = values
                if (lower, upper) not in targets:
                    continue
                resource = targets[lower, upper]
                if attributes >> 16 & 255 or max(size, packed_size) > MAX_PAYLOAD:
                    raise ValueError(f"Unsupported exact resource: {resource}")
                stream.seek(offset)
                packed = stream.read(packed_size)
                compression = attributes & 15
                decoded = packed if compression == 0 else zlib.decompress(packed, -15) if compression == 1 else zstd_decompress(packed, size)[0] if compression == 2 else None
                if decoded is None or len(decoded) != size:
                    raise ValueError(f"Resource decode failed: {resource}")
                destination = OUT / "extracted" / resource
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(decoded)
                entries.append({"resource": resource, "archive": str(archive), "index": row,
                    "entryOffset": 16 + row * 48, "offset": offset, "packedBytes": packed_size,
                    "bytes": size, "compression": compression, "attributes": hex(attributes),
                    "packedSha256": sha(packed), "sha256": sha(decoded), "output": str(destination)})
    missing = sorted(set(RESOURCES) - {e["resource"] for e in entries})
    report = {"archives": archive_reports, "entries": entries, "missing": missing,
        "scope": "Exact resource hashes, PAK directory indices and matching payloads only; no game runtime execution or modification."}
    write_json(OUT / "extraction.json", report)
    return report


def schemas():
    source = RESEARCH / ".local/sf6-character-audio/rszsf6.json"
    result = {int(k, 16): v for k, v in json.loads(source.read_text(encoding="utf-8")).items()}
    # The current TDB PartsTypeNo has Type and ID, no obsolete partsNo member.
    # Remove that old flattened union only; all instance/padding/EOF checks remain mandatory.
    for schema in result.values():
        if schema["name"] == "app.battle.assets.PartsContainer.Info":
            schema["fields"] = [f for f in schema["fields"] if not f["name"].startswith("STRUCT_partsNo_")]
        for field in schema["fields"]:
            if field["type"] == "Resource":
                field["type"] = "String"
            if field["type"] == "UserData":
                field["type"] = "Object"
    return result, {"file": str(source), "sha256": sha(source.read_bytes())}


def decode_rsz(data, offset, definitions):
    _, version, object_count, instance_count, user_count, _, info_offset, data_offset, user_offset = struct.unpack_from("<6I3Q", data, offset)
    if version != 16:
        raise ValueError("Unsupported RSZ version")
    infos = list(struct.iter_unpack("<II", data[offset + info_offset:offset + info_offset + instance_count * 8]))
    external = {}
    for i in range(user_count):
        instance, tid, pointer = struct.unpack_from("<IIQ", data, offset + user_offset + i * 16)
        end = offset + pointer
        while data[end:end + 2] != b"\0\0":
            end += 2
        external[instance] = data[offset + pointer:end].decode("utf-16le")
    cursor = offset + data_offset
    primitive = {"Bool": "?", "S8": "b", "U8": "B", "S16": "h", "U16": "H", "S32": "i", "U32": "I",
        "S64": "q", "U64": "Q", "F32": "f", "F64": "d", "Object": "I", "Sfix": "i"}
    result = [{"index": 0, "type": "null", "fields": {}}]
    checks = []

    def align(count):
        nonlocal cursor
        end = (cursor + count - 1) // count * count
        if any(data[cursor:end]):
            raise ValueError(("Nonzero alignment padding", cursor, end))
        cursor = end

    def read(fmt):
        nonlocal cursor
        value = struct.unpack_from("<" + fmt, data, cursor)[0]
        cursor += struct.calcsize("<" + fmt)
        return value

    def scalar(field):
        nonlocal cursor
        kind = field["type"]
        if kind in primitive:
            value = read(primitive[kind])
            if kind == "Object" and not 0 <= value < instance_count:
                raise ValueError(("Invalid reference", cursor, value))
            return value
        if kind == "String":
            length = read("I")
            if length > 100000:
                raise ValueError(("Unbounded string", cursor, length))
            value = data[cursor:cursor + length * 2].decode("utf-16le").rstrip("\0")
            cursor += length * 2
            return value
        value = data[cursor:cursor + field["size"]]
        cursor += field["size"]
        return {"type": kind, "hex": value.hex()}

    for index, (tid, crc) in enumerate(infos[1:], 1):
        schema = definitions[tid]
        if index in external:
            result.append({"index": index, "type": schema["name"], "external": external[index], "fields": {}})
            continue
        fields, field_offsets = {}, {}
        checks.append({"type": schema["name"], "typeId": hex(tid), "fileCrc": hex(crc),
            "schemaCrc": schema["crc"], "matches": crc == int(schema["crc"], 16)})
        for field in schema["fields"]:
            align(4 if field["array"] else field["align"])
            # Public schemas sometimes expose both a ushort union and its two bytes.
            # Preserve each serialized location despite their duplicate display names.
            name = field["name"]
            if name in fields:
                name += "_byte"
            field_offsets[name] = cursor
            if field["array"]:
                length = read("I")
                if length > 100000:
                    raise ValueError(("Unbounded array", cursor, length))
                values = []
                for _ in range(length):
                    align(field["align"])
                    values.append(scalar(field))
                fields[name] = values
            else:
                fields[name] = scalar(field)
        result.append({"index": index, "type": schema["name"], "fields": fields, "fieldOffsets": field_offsets, "endOffset": cursor})
    return {"offset": offset, "objects": list(struct.unpack_from("<" + "I" * object_count, data, offset + 48)),
        "instances": result, "schemaChecks": checks, "endOffset": cursor}


def inspect_appearance(extraction):
    definitions, schema_source = schemas()
    parts, shape = [], None
    for entry in extraction["entries"]:
        if not ("_model_parts.user" in entry["resource"] or entry["resource"].endswith("esf021_001_shape.user.2")):
            continue
        data = Path(entry["output"]).read_bytes()
        decoded = decode_rsz(data, struct.unpack_from("<Q", data, 32)[0], definitions)
        if decoded["endOffset"] > len(data) or any(data[decoded["endOffset"]:]):
            raise ValueError(("Unconsumed serialized bytes", entry["resource"], decoded["endOffset"], len(data)))
        decoded.update(resource=entry["resource"], sha256=entry["sha256"], fileBytes=len(data))
        write_json(OUT / (Path(entry["resource"]).name + ".decoded.json"), decoded)
        if "_model_parts.user" in entry["resource"]:
            mapped = []
            for item in decoded["instances"]:
                if item["type"] != "app.battle.assets.PartsContainer.Info":
                    continue
                f = item["fields"]
                mapped.append({"partsId": f["No"], "type": f["STRUCT_partsData_Type"],
                    "group1P": f["STRUCT_ID_Raw_byte"], "group2P": f["STRUCT_ID_Side2P"],
                    "defaultOn": f["defON"], "mesh": f["mesh"], "hash1": f["Hash1"], "hash2": f["Hash2"],
                    "fieldOffsets": item["fieldOffsets"]})
            parts.append({"resource": entry["resource"], "sha256": entry["sha256"], "parts": mapped,
                "decodedToEOF": decoded["endOffset"] == len(data)})
        else:
            shape = {"resource": entry["resource"], "sha256": entry["sha256"],
                "materials": [i["fields"] for i in decoded["instances"] if i["type"] == "app.esports.MuscleControl._TargetMaterial"],
                "shapeNames": sorted({str(v) for i in decoded["instances"] for v in i["fields"].values() if isinstance(v, str) and v.startswith("BS_")})}

    original = RESEARCH / "research/sf6-ai/combat-values/re_chunk_000-entry101963-021.fchar.18"
    data = original.read_bytes()
    retained = json.loads((RESEARCH / "research/sf6-ai/combat-values/selected-combat-raw.json").read_text(encoding="utf-8"))
    source = next(row for row in retained if "021.fchar" in row["file"])
    if source["sha256"] != sha(data):
        raise ValueError("Retained style evidence belongs to a different original fchar")
    ids, parents, pointers = struct.unpack_from("<3Q", data, 0x10)
    style_count = struct.unpack_from("<I", data, 0x5c)[0]
    styles = []
    for style_index in range(style_count):
        style_id = struct.unpack_from("<I", data, ids + style_index * 4)[0]
        parent = struct.unpack_from("<i", data, parents + style_index * 4)[0]
        pointer = struct.unpack_from("<Q", data, pointers + style_index * 8)[0]
        action_table, rsz_offset, _, action_count, _ = struct.unpack_from("<3Q2I", data, pointer)
        block = next(b for b in source["blocks"] if b["rszOffset"] == rsz_offset)
        instances = block["instances"]
        owner = next(i for i in instances if i["type"] == "CharacterAsset.StyleData")
        part_data = instances[owner["fields"]["Parts"]]
        references = part_data["fields"]["DefaultProps"]
        field_offset = part_data["fieldFileOffsets"]["DefaultProps"]
        if struct.unpack_from("<I", data, field_offset)[0] != len(references):
            raise ValueError("DefaultProps array count is not source-bound")
        if list(struct.unpack_from("<" + "I" * len(references), data, field_offset + 4)) != references:
            raise ValueError("DefaultProps references are not source-bound")
        props = []
        for ref in references:
            prop = instances[ref]
            offsets = prop["fieldFileOffsets"]
            # Source primitive validation is independent of the retained JSON.
            if data[offsets["PartsID"]] != prop["fields"]["PartsID"] or bool(data[offsets["IsON"]]) != prop["fields"]["IsON"]:
                raise ValueError("DefaultProps value is not source-bound")
            props.append({"partsId": prop["fields"]["PartsID"], "on": prop["fields"]["IsON"],
                "fieldOffsets": {"PartsID": offsets["PartsID"], "IsON": offsets["IsON"]}})
        overridden = []
        for index in range(action_count):
            action = struct.unpack_from("<Q", data, action_table + index * 8)[0]
            action_id = struct.unpack_from("<I", data, action + 32)[0]
            if action_id in [1211, 1212, 1213, 1215, 1216, 1217]:
                overridden.append(action_id)
        styles.append({"styleId": style_id, "parentStyle": parent, "rszOffset": rsz_offset,
            "defaultProps": props, "captureActionsAuthoredInStyle": overridden})

    parts.sort(key=lambda item: item["resource"])
    evidence = {"schemaSource": schema_source, "partsLayoutPatch": {
        "reason": "Current TDB app.battle.PartsTypeNo has Type and ID only. Removed obsolete flattened STRUCT_partsNo fields from the old public PartsContainer.Info schema.",
        "validation": "All four files independently consume every byte through EOF with zero alignment padding and bounded object references; current TDB field names retained separately."},
        "partsContainers": parts, "shape": shape, "fchar": {"file": str(original), "sha256": sha(data), "styles": styles}}
    write_json(OUT / "appearance-evidence.json", evidence)
    return evidence


def record_current_parts_types():
    destination = OUT / "parts-current-types.json"
    if destination.exists():
        return json.loads(destination.read_text(encoding="utf-8"))
    sys.path.insert(0, str(RESEARCH / "research/sf6-ai"))
    from parse_tdb71 import PEImage, TDB71
    executable = GAME / "StreetFighter6.exe"
    image = PEImage(executable)
    try:
        tdb = TDB71(image, 0xd03c9c0)
        names = {"app.battle.PARTS_TYPE", "app.battle.PartsNo", "app.battle.PartsTypeNo", "app.battle.assets.PartsContainer.Info"}
        types = []
        for index in range(1, len(tdb.types)):
            if tdb.base_name(index) in names:
                exported = tdb.export_type(index)
                types.append({k: v for k, v in exported.items() if k != "methods"})
        container = next(t for t in types if t["name"] == "app.battle.PartsTypeNo")
        if [f["name"] for f in container["fields"] if not f["isStatic"]] != ["Type", "ID"]:
            raise ValueError("Current PartsTypeNo layout does not match the validated resource decoder")
        report = {"source": str(executable), "sourceSha256": sha(image.data), "tdbOffset": "0xd03c9c0", "types": types,
            "scope": "Read-only on-disk TDB metadata; no process attachment or target execution."}
        write_json(destination, report)
        return report
    finally:
        image.close()


def write_runtime_manifest(evidence, extraction, metadata):
    containers = evidence["partsContainers"]
    baseline = containers[0]["parts"]
    projected = lambda values: [(p["partsId"], p["type"], p["group1P"], p["group2P"]) for p in values]
    if not all(projected(container["parts"]) == projected(baseline) for container in containers):
        raise ValueError("Costume parts differ; do not silently share an appearance mapping")
    styles = evidence["fchar"]["styles"]
    style_ids = {style["styleId"]: [p["partsId"] for p in style["defaultProps"] if p["on"]] for style in styles}
    if any(style_ids[level] != [0, 2, 4, 7] for level in range(4)) or style_ids[4] != [1, 3, 4, 7]:
        raise ValueError("Unexpected original Jamie drink-style defaults")
    public_parts = [{k: p[k] for k in ["partsId", "type", "group1P", "group2P", "defaultOn"]} for p in baseline]
    all_groups = sorted({p["group1P"] for p in baseline} | {p["group2P"] for p in baseline})
    table = {p["partsId"]: p for p in baseline}
    levels = {}
    for level in range(5):
        ids = style_ids[level]
        levels[level] = {"nativeStyle": level, "partsIds": ids,
            "groups1P": sorted(table[part]["group1P"] for part in ids),
            "groups2P": sorted(table[part]["group2P"] for part in ids)}
    manifest = {"schemaVersion": 1, "character": "jamie", "costume": 1,
        "parts": public_parts, "managedGroups": all_groups, "drinkLevels": levels,
        "nativeTemporaryStyles": {str(style): ids for style, ids in style_ids.items() if style >= 5},
        "source": {"fcharSha256": evidence["fchar"]["sha256"], "executableSha256": metadata["sourceSha256"],
            "partsContainers": [{"resource": p["resource"], "sha256": p["sha256"]} for p in containers],
            "extractionEvidence": ".local/sf6-v3/appearance/extraction.json",
            "decodedEvidence": ".local/sf6-v3/appearance/appearance-evidence.json",
            "typeEvidence": ".local/sf6-v3/appearance/parts-current-types.json",
            "styleDefaultProps": [{"style": s["styleId"], "rszOffset": s["rszOffset"], "partsIds": style_ids[s["styleId"]]} for s in styles],
            "shapeResource": evidence["shape"]["resource"], "shapeSha256": evidence["shape"]["sha256"]},
        "limitations": [
            "This review selects original default parts from each actor's actual drink level. Temporary SA2 effective style is not an actual drink-level input.",
            "Hand-held gourd parts 5/6/8 remain off because they are not original defaults for these capture clips.",
            "The native 1P/2P parts IDs are applied without rotating either paired animation.",
            "Body group 21 includes the original alternate jacket, zipper and torso submeshes; no invented body scaling or morph target is added.",
            "Original pants/TopA/TopB pose-corrective shape drivers are separate from selecting the four-drink mesh set.",
        ]}
    target = REPO / "public/assets/jamie/cinematic/appearance.json"
    serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if not target.exists() or target.read_text(encoding="utf-8") != serialized:
            raise ValueError("Cinematic appearance manifest is stale")
    else:
        write_json(target, manifest)
    write_json(OUT / "resource-summary.json", {"resources": [{k: entry[k] for k in ["resource", "sha256", "archive", "index", "offset", "bytes"]} for entry in extraction["entries"]]})
    return manifest


if __name__ == "__main__":
    result = extract()
    appearance = inspect_appearance(result)
    metadata = record_current_parts_types()
    runtime = write_runtime_manifest(appearance, result, metadata)
    print(json.dumps({"extracted": len(result["entries"]), "missing": result["missing"],
        "parts": len(appearance["partsContainers"]), "styles": len(appearance["fchar"]["styles"]),
        "runtimeLevels": runtime["drinkLevels"],
        "evidence": str(OUT / "appearance-evidence.json")}, ensure_ascii=False))
