NORMALIZED CLEAN CORE INPUTS

These files summarize the four supplied source extracts, not a complete SAP
inventory or a completed assessment. Six custom implementation/exit entries
were identified. The RTR source contains three separate enhancement snippets.
The BAdI implementation and its linked implementation class are not double-counted.

IMPORT ORDER (Evidence & Sources -> select evidence type -> upload CSV)
1. 01_object_metadata.csv -> Object metadata (object-metadata): 6 records.
2. 02_enhancements.csv -> Enhancements (enhancements): 6 records.
3. 03_custom_code_observations.csv -> Custom code (custom-code): 8 observations.
4. 04_interface_candidate.csv -> Interfaces (interfaces): 1 candidate, OPTIONAL.

Use the actual SAP system and target S/4HANA 2025. Start a fresh assessment or
back up first: importing REPLACES the current evidence set of the selected type.
Upload these combined files once each, not one file per source document.
After import, run the assessment. Treat classifications/recommendations as
provisional until independently validated.

SOURCE CODE
Attach sources/*.abap to the matching selected object/interface using:
Object Explorer or Interfaces -> Source code -> Choose File -> Review upload.
Do not import these ABAP files through Upload Evidence. They remain source
snippets, not necessarily complete compilable programs. Nothing is executed.
Each excerpt preserves business logic; only encoding, line endings and prose
headings were normalized. The PO extract was decoded from Windows-1252 /
ISO-8859-1-compatible bytes, including non-breaking spaces in its heading.
The three RTR excerpts were split at their supplied headings. Names such as
CONTORL are preserved exactly as supplied, not automatically corrected.

IMPORTANT LIMITATIONS
- No actual ATC/Cloud Readiness results were supplied. Do NOT import file 03 as ATC.
- No ST03N/SCMON/SUSG usage data was supplied. Missing usage is UNKNOWN, not zero.
- No automatic A/B/C/D level, API release status, size, complexity score, owner,
  package, collection period, transport or ambiguous change date was invented.
- ENHO/PROG identifiers inferred from labels/includes need SAP repository checks.
- The IDoc row is a source-comment/code-derived candidate, not proof of a live
  interface, its recipient systems, configuration or actual execution.
- SAP standard objects/dependencies are linked, not invented as custom objects.
- The linked class ZCL_IM_IM_SCM_ROUTE remains a dependency of ZIM_SCM_ROUTE;
  add its independent inventory record only if your chosen TADIR scope requires it.
- Add real TADIR/SE80, ATC, usage, enhancement and interface configuration extracts
  for a complete assessment. Do not overwrite a larger existing inventory with
  this six-record subset unless that is intentional.
- Source-review observations are human-readable source evidence, not certified
  security defects, SAP contract determinations or verified target-release failures.

PROVENANCE
CSV findings cite original filenames and original line ranges.
provenance_manifest.json records original/output SHA-256 checksums, encoding,
excerpt boundaries and the formula mapping normalized lines to original lines.
Do not upload this README or provenance_manifest.json as assessment evidence.
