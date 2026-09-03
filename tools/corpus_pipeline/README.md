# Prima Vista corpus pipeline

This offline pipeline turns licensed, two-staff piano MusicXML into style-pack statistics and auditable two-bar fragments. It never runs in the browser and never places source scores in the deployed site.

## License boundary

The commercial path accepts only public-domain, CC0, and explicitly approved permissive encodings. `NC`, `NonCommercial`, and `ShareAlike` records are rejected before parsing. PDMX records must also declare `no_license_conflict: true`. Every accepted and rejected record is written to the provenance SQLite database.

`music21` 10.5.0 is pinned. Its project metadata identifies the code as BSD-3-Clause, while warning that individual corpus encodings have separate rights; this pipeline therefore does not treat the bundled `music21` corpus as automatically cleared: https://pypi.org/project/music21/10.5.0/

## Manifest

Pass a JSON Lines manifest with one object per score:

```json
{"path":"/corpus/score.musicxml","source":"OpenScore","source_id":"openscore:123","genre":"classical_early","composer":"W. A. Mozart","work":"K. 545","license":"CC0-1.0","no_license_conflict":true}
```

Run:

```bash
python tools/corpus_pipeline/pipeline.py manifest.jsonl --out corpus-output
```

The output contains `provenance.sqlite`, per-genre analysis JSON, generated style packs, and a provenance-bearing fragment library. Review genre buckets and accompaniment-cluster labels before promoting the generated packs into `src/data/style-packs/`.

