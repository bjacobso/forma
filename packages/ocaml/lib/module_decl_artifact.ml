let string_field name value = (name, Ir_json.String value)

let string_array values =
  Ir_json.Array (List.map (fun value -> Ir_json.String value) values)

let optional_string_field name = function
  | None -> []
  | Some value -> [ string_field name value ]

let known_preludes =
  [
    "kernel";
    "compiler";
    "ontology";
    "ontology-compiler";
    "ontology.alpha";
    "actor.alpha";
    "ui.alpha";
  ]

let import_json (import : Module_decl.module_import) =
  Ir_json.Object
    ([
       string_field "specifier" import.specifier;
       string_field "mode" import.mode;
     ]
    @ optional_string_field "resolvedPath" import.resolved_path
    @ optional_string_field "moduleId" import.module_id
    @ optional_string_field "alias" import.alias
    @ if import.names = [] then [] else [ ("names", string_array import.names) ])

let use_json use = Ir_json.Object [ string_field "prelude" use.Module_decl.prelude ]

let declaration_json declaration =
  Ir_json.Object
    [
      string_field "localName" declaration.Module_decl.local_name;
      string_field "kind" declaration.kind;
      string_field "canonicalName" declaration.canonical_name;
    ]

let export_json declarations_by_name module_id name =
  let kind, canonical_name =
    match List.assoc_opt name declarations_by_name with
    | Some declaration -> (Some declaration.Module_decl.kind, declaration.canonical_name)
    | None -> (None, module_id ^ "/" ^ name)
  in
  Ir_json.Object
    ([
       string_field "localName" name;
       string_field "exportedName" name;
       string_field "canonicalName" canonical_name;
     ]
    @ optional_string_field "kind" kind)

let re_export_json (re_export : Module_decl.module_re_export) =
  Ir_json.Object
    ([
       string_field "specifier" re_export.specifier;
       ("names", string_array re_export.names);
     ]
    @ optional_string_field "resolvedPath" re_export.resolved_path
    @ optional_string_field "moduleId" re_export.module_id)

let right_shift x bits = Int64.shift_right_logical x bits

let u32 x = Int64.logand x 0xffffffffL

let add32 values =
  List.fold_left (fun acc value -> u32 (Int64.add acc value)) 0L values

let rotr x bits =
  u32
    (Int64.logor (right_shift x bits)
       (Int64.shift_left x (32 - bits)))

let sha256_hex source =
  let k =
    [|
      0x428a2f98L; 0x71374491L; 0xb5c0fbcfL; 0xe9b5dba5L; 0x3956c25bL;
      0x59f111f1L; 0x923f82a4L; 0xab1c5ed5L; 0xd807aa98L; 0x12835b01L;
      0x243185beL; 0x550c7dc3L; 0x72be5d74L; 0x80deb1feL; 0x9bdc06a7L;
      0xc19bf174L; 0xe49b69c1L; 0xefbe4786L; 0x0fc19dc6L; 0x240ca1ccL;
      0x2de92c6fL; 0x4a7484aaL; 0x5cb0a9dcL; 0x76f988daL; 0x983e5152L;
      0xa831c66dL; 0xb00327c8L; 0xbf597fc7L; 0xc6e00bf3L; 0xd5a79147L;
      0x06ca6351L; 0x14292967L; 0x27b70a85L; 0x2e1b2138L; 0x4d2c6dfcL;
      0x53380d13L; 0x650a7354L; 0x766a0abbL; 0x81c2c92eL; 0x92722c85L;
      0xa2bfe8a1L; 0xa81a664bL; 0xc24b8b70L; 0xc76c51a3L; 0xd192e819L;
      0xd6990624L; 0xf40e3585L; 0x106aa070L; 0x19a4c116L; 0x1e376c08L;
      0x2748774cL; 0x34b0bcb5L; 0x391c0cb3L; 0x4ed8aa4aL; 0x5b9cca4fL;
      0x682e6ff3L; 0x748f82eeL; 0x78a5636fL; 0x84c87814L; 0x8cc70208L;
      0x90befffaL; 0xa4506cebL; 0xbef9a3f7L; 0xc67178f2L;
    |]
  in
  let h =
    [|
      0x6a09e667L; 0xbb67ae85L; 0x3c6ef372L; 0xa54ff53aL; 0x510e527fL;
      0x9b05688cL; 0x1f83d9abL; 0x5be0cd19L;
    |]
  in
  let length = String.length source in
  let bit_length = Int64.mul (Int64.of_int length) 8L in
  let padded_length =
    let with_one = length + 1 in
    let remainder = (with_one + 8) mod 64 in
    if remainder = 0 then with_one + 8 else with_one + 8 + (64 - remainder)
  in
  let bytes = Bytes.make padded_length '\000' in
  Bytes.blit_string source 0 bytes 0 length;
  Bytes.set bytes length (Char.chr 0x80);
  for i = 0 to 7 do
    let shift = (7 - i) * 8 in
    Bytes.set bytes
      (padded_length - 8 + i)
      (Char.chr (Int64.to_int (Int64.logand (right_shift bit_length shift) 0xffL)))
  done;
  let w = Array.make 64 0L in
  for chunk = 0 to (padded_length / 64) - 1 do
    let offset = chunk * 64 in
    for i = 0 to 15 do
      let base = offset + (i * 4) in
      w.(i) <-
        u32
          (Int64.logor
             (Int64.shift_left
                (Int64.of_int (Char.code (Bytes.get bytes base)))
                24)
             (Int64.logor
                (Int64.shift_left
                   (Int64.of_int (Char.code (Bytes.get bytes (base + 1))))
                   16)
                (Int64.logor
                   (Int64.shift_left
                      (Int64.of_int (Char.code (Bytes.get bytes (base + 2))))
                      8)
                   (Int64.of_int (Char.code (Bytes.get bytes (base + 3)))))))
    done;
    for i = 16 to 63 do
      let s0 =
        Int64.logxor (rotr w.(i - 15) 7)
          (Int64.logxor (rotr w.(i - 15) 18) (right_shift w.(i - 15) 3))
      in
      let s1 =
        Int64.logxor (rotr w.(i - 2) 17)
          (Int64.logxor (rotr w.(i - 2) 19) (right_shift w.(i - 2) 10))
      in
      w.(i) <- add32 [ w.(i - 16); s0; w.(i - 7); s1 ]
    done;
    let a = ref h.(0) in
    let b = ref h.(1) in
    let c = ref h.(2) in
    let d = ref h.(3) in
    let e = ref h.(4) in
    let f = ref h.(5) in
    let g = ref h.(6) in
    let hh = ref h.(7) in
    for i = 0 to 63 do
      let s1 = Int64.logxor (rotr !e 6) (Int64.logxor (rotr !e 11) (rotr !e 25)) in
      let ch = Int64.logxor (Int64.logand !e !f) (Int64.logand (Int64.lognot !e) !g) in
      let temp1 = add32 [ !hh; s1; ch; k.(i); w.(i) ] in
      let s0 = Int64.logxor (rotr !a 2) (Int64.logxor (rotr !a 13) (rotr !a 22)) in
      let maj =
        Int64.logxor (Int64.logand !a !b)
          (Int64.logxor (Int64.logand !a !c) (Int64.logand !b !c))
      in
      let temp2 = add32 [ s0; maj ] in
      hh := !g;
      g := !f;
      f := !e;
      e := add32 [ !d; temp1 ];
      d := !c;
      c := !b;
      b := !a;
      a := add32 [ temp1; temp2 ]
    done;
    h.(0) <- add32 [ h.(0); !a ];
    h.(1) <- add32 [ h.(1); !b ];
    h.(2) <- add32 [ h.(2); !c ];
    h.(3) <- add32 [ h.(3); !d ];
    h.(4) <- add32 [ h.(4); !e ];
    h.(5) <- add32 [ h.(5); !f ];
    h.(6) <- add32 [ h.(6); !g ];
    h.(7) <- add32 [ h.(7); !hh ]
  done;
  Array.to_list h
  |> List.map (fun word -> Printf.sprintf "%08Lx" (u32 word))
  |> String.concat ""

let json_string source =
  let buffer = Buffer.create (String.length source + 2) in
  Buffer.add_char buffer '"';
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "\\\""
      | '\\' -> Buffer.add_string buffer "\\\\"
      | '\b' -> Buffer.add_string buffer "\\b"
      | '\012' -> Buffer.add_string buffer "\\f"
      | '\n' -> Buffer.add_string buffer "\\n"
      | '\r' -> Buffer.add_string buffer "\\r"
      | '\t' -> Buffer.add_string buffer "\\t"
      | char when Char.code char < 0x20 ->
          Buffer.add_string buffer (Printf.sprintf "\\u%04x" (Char.code char))
      | char -> Buffer.add_char buffer char)
    source;
  Buffer.add_char buffer '"';
  Buffer.contents buffer

let json_string_field name value =
  json_string name ^ ":" ^ json_string value

let json_string_array values =
  "[" ^ (values |> List.map json_string |> String.concat ",") ^ "]"

let export_hash_record declarations_by_name module_id name =
  let kind, canonical_name =
    match List.assoc_opt name declarations_by_name with
    | Some declaration -> (Some declaration.Module_decl.kind, declaration.canonical_name)
    | None -> (None, module_id ^ "/" ^ name)
  in
  let fields =
    [
      json_string_field "localName" name;
      json_string_field "exportedName" name;
    ]
    @
    (match kind with
    | None -> []
    | Some kind -> [ json_string_field "kind" kind ])
    @ [ json_string_field "canonicalName" canonical_name ]
  in
  "{" ^ String.concat "," fields ^ "}"

let re_export_hash_record (re_export : Module_decl.module_re_export) =
  let fields =
    [ json_string_field "specifier" re_export.specifier ]
    @
    (match re_export.resolved_path with
    | None -> []
    | Some resolved_path -> [ json_string_field "resolvedPath" resolved_path ])
    @
    (match re_export.module_id with
    | None -> []
    | Some module_id -> [ json_string_field "moduleId" module_id ])
    @
    [
      "\"names\":"
      ^ (re_export.names |> List.sort String.compare |> json_string_array);
    ]
  in
  "{" ^ String.concat "," fields ^ "}"

let public_export_hash_parts exports re_exports =
  let export_parts = List.sort String.compare exports in
  let re_export_parts =
    re_exports
    |> List.concat_map (fun (re_export : Module_decl.module_re_export) ->
        let names = List.sort String.compare re_export.names in
        [
          re_export.specifier;
          Option.value ~default:"" re_export.resolved_path;
          Option.value ~default:"" re_export.module_id;
          String.concat "," names;
        ])
    |> List.sort String.compare
  in
  Digest.to_hex
    (Digest.string (String.concat "|" (export_parts @ re_export_parts)))

let public_export_hash (decl : Module_decl.t) =
  public_export_hash_parts decl.explicit_exports decl.re_exports

let module_public_export_hash declarations_by_name module_id exports re_exports =
  let export_records =
    exports
    |> List.map (export_hash_record declarations_by_name module_id)
    |> List.sort String.compare
  in
  let re_export_records =
    re_exports |> List.map re_export_hash_record |> List.sort String.compare
  in
  let source =
    "{\"exports\":[" ^ String.concat "," export_records ^ "],\"reExports\":["
    ^ String.concat "," re_export_records ^ "]}"
  in
  sha256_hex source

let diagnostic_json code message =
  Ir_json.Object
    [
      string_field "severity" "error";
      string_field "code" code;
      string_field "phase" "project";
      string_field "message" message;
    ]

let diagnostic_json_with_notes code message notes suggestion =
  Ir_json.Object
    ([
       string_field "severity" "error";
       string_field "code" code;
       string_field "phase" "project";
       string_field "message" message;
       ( "notes",
         Ir_json.Array
           (List.map
              (fun (note_message, span_file) ->
                Ir_json.Object
                  ([
                     string_field "message" note_message;
                   ]
                  @
                  match span_file with
                  | None -> []
                  | Some file ->
                      [ ("span", Ir_json.Object [ string_field "file" file ]) ]))
              notes) );
     ]
    @
    match suggestion with
    | None -> []
    | Some suggestion -> [ string_field "suggestion" suggestion ])

let available_exports_text exported_names =
  match List.sort String.compare exported_names with
  | [] -> "(none)"
  | names -> String.concat ", " names

let missing_export_diagnostic code label name specifier module_id exported_names =
  let available = available_exports_text exported_names in
  diagnostic_json_with_notes code
    (Printf.sprintf "Unknown %s %S from %s." label name specifier)
    [
      (Printf.sprintf "Target module: %s" module_id, Some module_id);
      (Printf.sprintf "Available exports: %s" available, None);
    ]
    (Some
       (if exported_names = [] then
          "Add an export to the target module before importing it."
        else Printf.sprintf "Import or re-export one of: %s" available))

let unknown_local_export_diagnostics declarations_by_name exports =
  exports
  |> List.filter_map (fun name ->
      if List.mem_assoc name declarations_by_name then None
      else
        Some
          (diagnostic_json "module.export.unknown-local"
             (Printf.sprintf "Cannot export unknown local declaration %S." name)))

let unknown_prelude_diagnostics used_preludes =
  used_preludes
  |> List.filter_map (fun (use : Module_decl.module_use) ->
      if List.mem use.prelude known_preludes then None
      else
        Some
          (diagnostic_json "module.use.unknown-prelude"
             (Printf.sprintf "Unknown prelude %S." use.prelude)))

let missing_file_diagnostic code label specifier =
  diagnostic_json code (Printf.sprintf "%s file not found: %s" label specifier)

let missing_export_diagnostics ~resolve_exports code label names specifier module_id =
  match module_id with
  | None -> []
  | Some module_id -> (
      match resolve_exports module_id with
      | None -> []
      | Some exported_names ->
          names
          |> List.filter_map (fun name ->
              if List.mem name exported_names then None
              else
                Some
                  (missing_export_diagnostic code label name specifier module_id
                     exported_names)))

let import_diagnostics ~resolve_exports imports =
  let aliases = Hashtbl.create 8 in
  let refer_owners = Hashtbl.create 8 in
  let diagnostics = ref [] in
  List.iter
    (fun (import : Module_decl.module_import) ->
      if
        String.starts_with ~prefix:"." import.specifier
        && Option.is_none import.module_id
      then
        diagnostics :=
          missing_file_diagnostic "module.import.missing-file" "Imported"
            import.specifier
          :: !diagnostics;
      (match import.alias with
      | Some alias ->
          if Hashtbl.mem aliases alias then
            diagnostics :=
              diagnostic_json "module.import.duplicate-alias"
                (Printf.sprintf "Duplicate import alias %S." alias)
              :: !diagnostics
          else Hashtbl.add aliases alias import.specifier
      | None -> ());
      if import.mode = "all" && not (String.starts_with ~prefix:"." import.specifier)
      then
        diagnostics :=
          diagnostic_json "module.import.all-non-local"
            ":all imports are only allowed for local relative modules."
          :: !diagnostics;
      if import.mode = "refer" then (
        diagnostics :=
          List.rev_append
            (missing_export_diagnostics ~resolve_exports
               "module.import.missing-export" "export" import.names
               import.specifier import.module_id)
            !diagnostics;
        List.iter
          (fun name ->
            match Hashtbl.find_opt refer_owners name with
            | Some owner when owner <> import.specifier ->
                diagnostics :=
                  diagnostic_json "module.import.ambiguous-name"
                    (Printf.sprintf
                       "Imported name %S is provided by both %s and %s." name
                       owner import.specifier)
                  :: !diagnostics
            | Some _ -> ()
            | None -> Hashtbl.add refer_owners name import.specifier)
          import.names))
    imports;
  List.rev !diagnostics

let re_export_diagnostics ~resolve_exports re_exports =
  re_exports
  |> List.concat_map (fun (re_export : Module_decl.module_re_export) ->
      let missing_file =
        if
          String.starts_with ~prefix:"." re_export.specifier
          && Option.is_none re_export.module_id
        then
          [
            missing_file_diagnostic "module.export-from.missing-file" "Re-exported"
              re_export.specifier;
          ]
        else []
      in
      missing_file
      @ missing_export_diagnostics ~resolve_exports
          "module.export-from.missing-export" "re-export" re_export.names
          re_export.specifier re_export.module_id)

let alias_reference_diagnostics ~resolve_exports imports alias_references =
  let alias_targets =
    imports
    |> List.filter_map (fun (import : Module_decl.module_import) ->
        match (import.mode, import.alias, import.module_id) with
        | "alias", Some alias, Some module_id -> Some (alias, module_id)
        | _ -> None)
  in
  alias_references
  |> List.filter_map (fun (reference : Module_decl.alias_reference) ->
      match List.assoc_opt reference.alias alias_targets with
      | None -> None
      | Some module_id -> (
          match resolve_exports module_id with
          | None -> None
          | Some exported_names ->
              if List.mem reference.local_name exported_names then None
              else
                Some
                  (diagnostic_json "module.reference.unbound"
                     (Printf.sprintf
                        "Unknown export %S referenced through alias %S."
                        reference.local_name reference.alias))))

let imported_names ~resolve_exports (import : Module_decl.module_import) =
  match import.mode with
  | "refer" -> import.names
  | "all" -> (
      match import.module_id with
      | None -> []
      | Some module_id -> (
          match resolve_exports module_id with
          | None -> []
          | Some names -> names))
  | _ -> []

let ambiguous_reference_diagnostics ~resolve_exports declarations_by_name imports
    unqualified_references =
  unqualified_references
  |> List.filter_map (fun name ->
      if List.mem_assoc name declarations_by_name then None
      else
        let owners =
          imports
          |> List.filter_map (fun import ->
              if List.mem name (imported_names ~resolve_exports import) then
                Some import.Module_decl.specifier
              else None)
          |> List.sort_uniq String.compare
        in
        if List.length owners < 2 then None
        else
          Some
            (diagnostic_json "module.reference.ambiguous"
               (Printf.sprintf
                  "Reference %S is ambiguous across imported modules: %s. Use a qualified import alias."
                  name (String.concat ", " owners))))

let module_diagnostics ~resolve_exports declarations_by_name (decl : Module_decl.t) =
  List.map
    (fun (diagnostic : Module_decl.module_diagnostic) ->
      diagnostic_json diagnostic.code diagnostic.message)
    decl.diagnostics
  @ unknown_prelude_diagnostics decl.used_preludes
  @ unknown_local_export_diagnostics declarations_by_name decl.explicit_exports
  @ import_diagnostics ~resolve_exports decl.imports
  @ re_export_diagnostics ~resolve_exports decl.re_exports
  @ alias_reference_diagnostics ~resolve_exports decl.imports decl.alias_references
  @ ambiguous_reference_diagnostics ~resolve_exports declarations_by_name decl.imports
      decl.unqualified_references

let to_json ?(resolve_exports = fun _ -> None)
    ~source_hash ~declarations (decl : Module_decl.t) =
  let declarations_by_name =
    List.filter_map
      (fun declaration -> Some (declaration.Module_decl.local_name, declaration))
      declarations
  in
  let export_names = decl.explicit_exports in
  Ir_json.Object
    [
      string_field "moduleId" decl.module_id;
      string_field "sourcePath" decl.source_path;
      string_field "sourceHash" source_hash;
      ("usedPreludes", Ir_json.Array (List.map use_json decl.used_preludes));
      ("imports", Ir_json.Array (List.map import_json decl.imports));
      ( "exports",
        Ir_json.Array
          (List.map (export_json declarations_by_name decl.module_id) export_names) );
      ("reExports", Ir_json.Array (List.map re_export_json decl.re_exports));
      ("declarations", Ir_json.Array (List.map declaration_json declarations));
      ( "diagnostics",
        Ir_json.Array (module_diagnostics ~resolve_exports declarations_by_name decl) );
      ( "publicExportHash",
        Ir_json.String
          (module_public_export_hash declarations_by_name decl.module_id
             export_names decl.re_exports) );
    ]
