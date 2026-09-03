// Generated from src/data/style-packs. Edit JSON packs, not this file.
export default [
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "classical_early",
    "id": "baroque",
    "display_name": "Baroque",
    "description": "Sequential motives, circle motion, contrapuntal clarity, and firm cadences.",
    "title": "Invention Study",
    "enabled": true,
    "tempo_range": [
      66,
      126
    ],
    "forms": [
      {
        "id": "baroque_8",
        "name": "Binary invention",
        "weight": 1,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "subject",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "sequence",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "episode",
            "transform": "invert",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "return",
            "transform": "fragment",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.25,
        "min_level": 1
      },
      {
        "id": "alberti",
        "weight": 0.15,
        "min_level": 3
      },
      {
        "id": "contrapuntal",
        "weight": 0.6,
        "min_level": 6
      }
    ],
    "melody": {
      "step_ratio_target": 0.72,
      "step_ratio_tolerance": 0.14,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "contours": [
        {
          "id": "wave",
          "weight": 0.5
        },
        {
          "id": "ascending",
          "weight": 0.25
        },
        {
          "id": "descending",
          "weight": 0.25
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "suspension",
        "escape"
      ]
    },
    "expression": {
      "dynamics": [
        "p",
        "mf",
        "f"
      ],
      "articulations": [
        "legato",
        "detached"
      ],
      "hairpin": false,
      "ornaments": {
        "allowed": [
          "turn",
          "mordent"
        ],
        "min_level": 6,
        "density": 0.09
      }
    },
    "validator": {
      "coherence_min": 0.5,
      "coherence_max": 0.94,
      "forbid_outer_parallels": true
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "folk",
    "id": "blues",
    "display_name": "Blues",
    "description": "Twelve-bar form, call-and-response riffs, blue-note inflection, and idiomatic turnarounds.",
    "title": "Blues Study",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 1
      }
    ],
    "modes": [
      {
        "value": "major",
        "weight": 0.72
      },
      {
        "value": "minor",
        "weight": 0.28
      }
    ],
    "tempo_range": [
      60,
      144
    ],
    "forms": [
      {
        "id": "blues_12",
        "name": "Twelve-bar blues",
        "weight": 1,
        "min_level": 3,
        "bars": 12,
        "units": [
          {
            "bars": [
              0,
              3
            ],
            "role": "call",
            "transform": "motif",
            "cadence": "subdominant_turn"
          },
          {
            "bars": [
              4,
              7
            ],
            "role": "response",
            "transform": "reharmonize",
            "cadence": "half"
          },
          {
            "bars": [
              8,
              11
            ],
            "role": "turnaround",
            "transform": "fragment",
            "cadence": "blues_turnaround"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I7",
        "IV7",
        "V7"
      ],
      "roman_degrees": {
        "I7": 0,
        "IV7": 3,
        "V7": 4
      },
      "altered_sevenths": [
        0,
        3
      ],
      "require_labelled_sevenths": true,
      "transitions": {
        "I7": {
          "I7": 0.58,
          "IV7": 0.32,
          "V7": 0.1
        },
        "IV7": {
          "IV7": 0.35,
          "I7": 0.55,
          "V7": 0.1
        },
        "V7": {
          "IV7": 0.42,
          "I7": 0.58
        }
      },
      "cadences": {
        "half": [
          [
            "I7",
            "V7"
          ]
        ],
        "authentic": [
          [
            "V7",
            "I7"
          ]
        ],
        "subdominant_turn": [
          [
            "I7",
            "IV7"
          ]
        ],
        "blues_turnaround": [
          [
            "IV7",
            "I7"
          ],
          [
            "I7",
            "V7"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "subdominant_turn": 0.55,
          "half": 0.45
        },
        "final": {
          "blues_turnaround": 0.6,
          "authentic": 0.4
        }
      },
      "harmonic_slots_by_level": {
        "1": 1,
        "5": 1,
        "8": 2
      },
      "licensed_retrogressions": [
        "V7>IV7"
      ]
    },
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.45,
        "min_level": 1
      },
      {
        "id": "broken_octave",
        "weight": 0.35,
        "min_level": 4
      },
      {
        "id": "walking",
        "weight": 0.2,
        "min_level": 7
      }
    ],
    "rhythm_cells": [
      {
        "id": "q",
        "meter": "simple",
        "min_level": 1,
        "weight": 0.5
      },
      {
        "id": "ee",
        "meter": "simple",
        "min_level": 2,
        "weight": 1
      },
      {
        "id": "eqe",
        "meter": "simple",
        "min_level": 4,
        "weight": 1.1
      },
      {
        "id": "trip",
        "meter": "simple",
        "min_level": 6,
        "weight": 1.25
      },
      {
        "id": "ssss",
        "meter": "simple",
        "min_level": 7,
        "weight": 0.45
      }
    ],
    "melody": {
      "step_ratio_target": 0.58,
      "step_ratio_tolerance": 0.18,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "blue_degrees": [
        2,
        4,
        6
      ],
      "blue_note_density": 0.22,
      "contours": [
        {
          "id": "wave",
          "weight": 0.5
        },
        {
          "id": "descending",
          "weight": 0.3
        },
        {
          "id": "arch",
          "weight": 0.2
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.5,
      "coherence_max": 0.95,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "id": "classical_early",
    "display_name": "Classical (early period)",
    "description": "Balanced periods, clear functional harmony, sequences, and economical accompaniment.",
    "title": "Classical Study",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.5
      },
      {
        "value": "3/4",
        "weight": 0.3
      },
      {
        "value": "2/4",
        "weight": 0.2
      }
    ],
    "modes": [
      {
        "value": "major",
        "weight": 0.78
      },
      {
        "value": "minor",
        "weight": 0.22
      }
    ],
    "tempo_range": [
      72,
      120
    ],
    "forms": [
      {
        "id": "phrase_4",
        "name": "Four-bar phrase",
        "weight": 0.2,
        "min_level": 1,
        "bars": 4,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "presentation",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "cadential",
            "transform": "reharmonize",
            "cadence": "authentic"
          }
        ]
      },
      {
        "id": "period_8",
        "name": "Parallel period",
        "weight": 0.55,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "presentation",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "antecedent",
            "transform": "reharmonize",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "return",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "cadential",
            "transform": "fragment",
            "cadence": "authentic"
          }
        ]
      },
      {
        "id": "sentence_8",
        "name": "Eight-bar sentence",
        "weight": 0.3,
        "min_level": 3,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "presentation",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "repetition",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": null
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "continuation",
            "transform": "fragment",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "cadential",
            "transform": "diminish",
            "cadence": "authentic"
          }
        ]
      },
      {
        "id": "period_16",
        "name": "Rounded binary",
        "weight": 0.15,
        "min_level": 5,
        "bars": 16,
        "units": [
          {
            "bars": [
              0,
              3
            ],
            "role": "presentation",
            "transform": "motif",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              7
            ],
            "role": "continuation",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": "authentic"
          },
          {
            "bars": [
              8,
              11
            ],
            "role": "development",
            "transform": "fragment",
            "cadence": "half"
          },
          {
            "bars": [
              12,
              15
            ],
            "role": "return",
            "transform": "exact",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I",
        "I6",
        "ii",
        "ii6",
        "IV",
        "V",
        "V6",
        "V7",
        "vi",
        "viio6"
      ],
      "roman_degrees": {
        "I": 0,
        "I6": 0,
        "ii": 1,
        "ii6": 1,
        "iii": 2,
        "IV": 3,
        "V": 4,
        "V6": 4,
        "V7": 4,
        "vi": 5,
        "viio6": 6
      },
      "transitions": {
        "I": {
          "I6": 0.14,
          "ii": 0.16,
          "IV": 0.22,
          "V": 0.24,
          "vi": 0.16,
          "iii": 0.08
        },
        "I6": {
          "ii6": 0.25,
          "IV": 0.28,
          "V": 0.27,
          "vi": 0.2
        },
        "ii": {
          "V": 0.7,
          "V7": 0.25,
          "viio6": 0.05
        },
        "ii6": {
          "V": 0.58,
          "V7": 0.35,
          "viio6": 0.07
        },
        "iii": {
          "vi": 0.55,
          "IV": 0.25,
          "ii": 0.2
        },
        "IV": {
          "I": 0.12,
          "ii": 0.18,
          "V": 0.45,
          "V7": 0.25
        },
        "V": {
          "I": 0.7,
          "vi": 0.18,
          "I6": 0.12
        },
        "V6": {
          "I": 0.72,
          "vi": 0.18,
          "I6": 0.1
        },
        "V7": {
          "I": 0.78,
          "vi": 0.22
        },
        "vi": {
          "ii": 0.32,
          "IV": 0.36,
          "V": 0.22,
          "I6": 0.1
        },
        "viio6": {
          "I": 0.8,
          "I6": 0.2
        }
      },
      "cadences": {
        "half": [
          [
            "ii6",
            "V"
          ],
          [
            "IV",
            "V"
          ],
          [
            "I6",
            "V"
          ]
        ],
        "authentic": [
          [
            "ii6",
            "V7",
            "I"
          ],
          [
            "IV",
            "V",
            "I"
          ],
          [
            "V7",
            "I"
          ]
        ],
        "imperfect": [
          [
            "ii6",
            "V7",
            "I6"
          ],
          [
            "IV",
            "V",
            "I6"
          ]
        ],
        "deceptive": [
          [
            "V7",
            "vi"
          ]
        ],
        "plagal": [
          [
            "IV",
            "I"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "half": 0.65,
          "deceptive": 0.2,
          "imperfect": 0.15
        },
        "final": {
          "authentic": 0.72,
          "imperfect": 0.18,
          "plagal": 0.1
        }
      },
      "harmonic_slots_by_level": {
        "1": 1,
        "5": 1,
        "7": 2
      },
      "licensed_retrogressions": []
    },
    "lh_textures": [
      {
        "id": "block_chord",
        "weight": 0.32,
        "min_level": 1
      },
      {
        "id": "root_fifth",
        "weight": 0.2,
        "min_level": 1
      },
      {
        "id": "alberti",
        "weight": 0.32,
        "min_level": 3
      },
      {
        "id": "broken_octave",
        "weight": 0.16,
        "min_level": 6
      }
    ],
    "rhythm_cells": [
      {
        "id": "q",
        "meter": "simple",
        "min_level": 1,
        "weight": 1.2
      },
      {
        "id": "h",
        "meter": "simple",
        "min_level": 1,
        "weight": 0.8
      },
      {
        "id": "ee",
        "meter": "simple",
        "min_level": 2,
        "weight": 1.1
      },
      {
        "id": "dqe",
        "meter": "simple",
        "min_level": 4,
        "weight": 0.65
      },
      {
        "id": "ssss",
        "meter": "simple",
        "min_level": 7,
        "weight": 0.45
      },
      {
        "id": "trip",
        "meter": "simple",
        "min_level": 9,
        "weight": 0.3
      },
      {
        "id": "cdq",
        "meter": "compound",
        "min_level": 4,
        "weight": 1
      },
      {
        "id": "ceee",
        "meter": "compound",
        "min_level": 4,
        "weight": 0.8
      }
    ],
    "melody": {
      "step_ratio_target": 0.78,
      "step_ratio_tolerance": 0.12,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "contours": [
        {
          "id": "arch",
          "weight": 0.52
        },
        {
          "id": "ascending",
          "weight": 0.16
        },
        {
          "id": "descending",
          "weight": 0.16
        },
        {
          "id": "wave",
          "weight": 0.16
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "appoggiatura",
        "suspension",
        "escape"
      ]
    },
    "development": {
      "recognizable_min_ratio": 0.5,
      "advanced_transforms": {
        "invert": 5,
        "augment": 5,
        "diminish": 5,
        "expand_intervals": 6
      }
    },
    "expression": {
      "dynamics": [
        "p",
        "mp",
        "mf",
        "f"
      ],
      "articulations": [
        "legato",
        "staccato",
        "tenuto"
      ],
      "hairpin": true,
      "ornaments": {
        "allowed": [
          "appoggiatura",
          "turn"
        ],
        "min_level": 6,
        "density": 0.08
      }
    },
    "validator": {
      "coherence_min": 0.25,
      "coherence_max": 0.93,
      "forbid_outer_parallels": true
    },
    "provenance": {
      "model": "bootstrap-hand-audited",
      "corpus_snapshot": null,
      "notes": "Seed pack; replace probabilities through the corpus-mining pipeline before claiming corpus calibration."
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "hymn_chorale",
    "id": "folk",
    "display_name": "Folk",
    "description": "Singable strains, primary-chord harmony, modal turns, and memorable returns.",
    "title": "Folk Tune",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.45
      },
      {
        "value": "3/4",
        "weight": 0.25
      },
      {
        "value": "2/4",
        "weight": 0.3
      }
    ],
    "tempo_range": [
      66,
      126
    ],
    "forms": [
      {
        "id": "folk_8",
        "name": "Strophic refrain",
        "weight": 1,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "call",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "answer",
            "transform": "reharmonize",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "refrain",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "close",
            "transform": "fragment",
            "cadence": "plagal"
          }
        ]
      }
    ],
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.6,
        "min_level": 1
      },
      {
        "id": "block_chord",
        "weight": 0.3,
        "min_level": 1
      },
      {
        "id": "broken_octave",
        "weight": 0.1,
        "min_level": 5
      }
    ],
    "melody": {
      "step_ratio_target": 0.84,
      "step_ratio_tolerance": 0.11,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "contours": [
        {
          "id": "arch",
          "weight": 0.45
        },
        {
          "id": "descending",
          "weight": 0.25
        },
        {
          "id": "wave",
          "weight": 0.3
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.52,
      "coherence_max": 0.95,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "classical_early",
    "id": "hymn_chorale",
    "display_name": "Hymn / chorale",
    "description": "Four-square phrases, singable melody, plagal color, and disciplined common-tone voice leading.",
    "title": "Chorale Prelude",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.72
      },
      {
        "value": "3/4",
        "weight": 0.18
      },
      {
        "value": "2/4",
        "weight": 0.1
      }
    ],
    "modes": [
      {
        "value": "major",
        "weight": 0.7
      },
      {
        "value": "minor",
        "weight": 0.3
      }
    ],
    "tempo_range": [
      56,
      96
    ],
    "forms": [
      {
        "id": "hymn_4",
        "name": "Four-bar hymn phrase",
        "weight": 0.2,
        "min_level": 1,
        "bars": 4,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "statement",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "answer",
            "transform": "reharmonize",
            "cadence": "plagal"
          }
        ]
      },
      {
        "id": "hymn_period_8",
        "name": "Hymn period",
        "weight": 0.62,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "statement",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "antecedent",
            "transform": "reharmonize",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "answer",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "close",
            "transform": "fragment",
            "cadence": "plagal"
          }
        ]
      },
      {
        "id": "chorale_16",
        "name": "Four-phrase chorale",
        "weight": 0.18,
        "min_level": 5,
        "bars": 16,
        "units": [
          {
            "bars": [
              0,
              3
            ],
            "role": "statement",
            "transform": "motif",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              7
            ],
            "role": "answer",
            "transform": "reharmonize",
            "cadence": "authentic"
          },
          {
            "bars": [
              8,
              11
            ],
            "role": "contrast",
            "transform": "transpose_diatonic",
            "transform_value": -1,
            "cadence": "half"
          },
          {
            "bars": [
              12,
              15
            ],
            "role": "final",
            "transform": "exact",
            "cadence": "plagal"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I",
        "I6",
        "ii6",
        "IV",
        "IV6",
        "V",
        "V7",
        "vi",
        "viio6"
      ],
      "roman_degrees": {
        "I": 0,
        "I6": 0,
        "ii6": 1,
        "IV": 3,
        "IV6": 3,
        "V": 4,
        "V7": 4,
        "vi": 5,
        "viio6": 6
      },
      "transitions": {
        "I": {
          "I6": 0.15,
          "ii6": 0.2,
          "IV": 0.3,
          "V": 0.2,
          "vi": 0.15
        },
        "I6": {
          "ii6": 0.28,
          "IV": 0.34,
          "V": 0.24,
          "vi": 0.14
        },
        "ii6": {
          "V": 0.62,
          "V7": 0.33,
          "viio6": 0.05
        },
        "IV": {
          "I": 0.34,
          "ii6": 0.16,
          "V": 0.32,
          "V7": 0.18
        },
        "IV6": {
          "I": 0.34,
          "V": 0.46,
          "V7": 0.2
        },
        "V": {
          "I": 0.78,
          "vi": 0.16,
          "I6": 0.06
        },
        "V7": {
          "I": 0.84,
          "vi": 0.16
        },
        "vi": {
          "ii6": 0.28,
          "IV": 0.42,
          "V": 0.2,
          "I6": 0.1
        },
        "viio6": {
          "I": 0.84,
          "I6": 0.16
        }
      },
      "cadences": {
        "half": [
          [
            "IV",
            "V"
          ],
          [
            "ii6",
            "V"
          ]
        ],
        "authentic": [
          [
            "ii6",
            "V7",
            "I"
          ],
          [
            "IV",
            "V",
            "I"
          ]
        ],
        "imperfect": [
          [
            "IV",
            "V",
            "I6"
          ]
        ],
        "deceptive": [
          [
            "V7",
            "vi"
          ]
        ],
        "plagal": [
          [
            "IV",
            "I"
          ],
          [
            "IV6",
            "I"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "half": 0.62,
          "plagal": 0.25,
          "deceptive": 0.13
        },
        "final": {
          "plagal": 0.5,
          "authentic": 0.4,
          "imperfect": 0.1
        }
      },
      "licensed_retrogressions": []
    },
    "lh_textures": [
      {
        "id": "block_chord",
        "weight": 0.64,
        "min_level": 1
      },
      {
        "id": "root_fifth",
        "weight": 0.24,
        "min_level": 1
      },
      {
        "id": "broken_octave",
        "weight": 0.12,
        "min_level": 6
      }
    ],
    "melody": {
      "step_ratio_target": 0.82,
      "step_ratio_tolerance": 0.1,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "contours": [
        {
          "id": "arch",
          "weight": 0.56
        },
        {
          "id": "ascending",
          "weight": 0.12
        },
        {
          "id": "descending",
          "weight": 0.2
        },
        {
          "id": "wave",
          "weight": 0.12
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "suspension"
      ]
    },
    "expression": {
      "dynamics": [
        "p",
        "mp",
        "mf",
        "f"
      ],
      "articulations": [
        "legato",
        "tenuto"
      ],
      "hairpin": true,
      "ornaments": {
        "allowed": [],
        "min_level": 10,
        "density": 0
      }
    },
    "validator": {
      "coherence_min": 0.48,
      "coherence_max": 0.94,
      "forbid_outer_parallels": true
    },
    "provenance": {
      "model": "bootstrap-hand-audited",
      "corpus_snapshot": null,
      "notes": "Seed pack for the first corpus A/B pass; probabilities are explicitly marked unmined."
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "blues",
    "id": "jazz_lead",
    "display_name": "Jazz lead sheet",
    "description": "Compact song form, seventh-chord motion, syncopated melody, and guide-tone-aware phrasing.",
    "title": "Lead-Sheet Study",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.72
      },
      {
        "value": "3/4",
        "weight": 0.13
      },
      {
        "value": "6/8",
        "weight": 0.15
      }
    ],
    "tempo_range": [
      60,
      160
    ],
    "forms": [
      {
        "id": "jazz_aaba_16",
        "name": "Condensed AABA",
        "weight": 1,
        "min_level": 5,
        "bars": 16,
        "units": [
          {
            "bars": [
              0,
              3
            ],
            "role": "A1",
            "transform": "motif",
            "cadence": "half"
          },
          {
            "bars": [
              4,
              7
            ],
            "role": "A2",
            "transform": "reharmonize",
            "cadence": "authentic"
          },
          {
            "bars": [
              8,
              11
            ],
            "role": "bridge",
            "transform": "transpose_diatonic",
            "transform_value": 2,
            "cadence": "half"
          },
          {
            "bars": [
              12,
              15
            ],
            "role": "A3",
            "transform": "exact",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I",
        "ii",
        "V7",
        "vi",
        "IV",
        "iii",
        "VI7"
      ],
      "roman_degrees": {
        "I": 0,
        "ii": 1,
        "iii": 2,
        "IV": 3,
        "V7": 4,
        "vi": 5,
        "VI7": 5
      },
      "transitions": {
        "I": {
          "vi": 0.25,
          "VI7": 0.2,
          "ii": 0.25,
          "IV": 0.15,
          "iii": 0.15
        },
        "ii": {
          "V7": 0.82,
          "vi": 0.18
        },
        "iii": {
          "VI7": 0.62,
          "vi": 0.38
        },
        "IV": {
          "ii": 0.35,
          "V7": 0.45,
          "I": 0.2
        },
        "V7": {
          "I": 0.68,
          "vi": 0.2,
          "iii": 0.12
        },
        "vi": {
          "ii": 0.48,
          "IV": 0.28,
          "VI7": 0.24
        },
        "VI7": {
          "ii": 0.82,
          "IV": 0.18
        }
      },
      "cadences": {
        "half": [
          [
            "ii",
            "V7"
          ]
        ],
        "authentic": [
          [
            "ii",
            "V7",
            "I"
          ]
        ],
        "deceptive": [
          [
            "V7",
            "vi"
          ]
        ],
        "plagal": [
          [
            "IV",
            "I"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "half": 0.55,
          "deceptive": 0.45
        },
        "final": {
          "authentic": 0.65,
          "plagal": 0.2,
          "deceptive": 0.15
        }
      },
      "licensed_retrogressions": [
        "V7>IV"
      ]
    },
    "lh_textures": [
      {
        "id": "block_chord",
        "weight": 0.35,
        "min_level": 5
      },
      {
        "id": "root_fifth",
        "weight": 0.25,
        "min_level": 4
      },
      {
        "id": "walking",
        "weight": 0.4,
        "min_level": 7
      }
    ],
    "melody": {
      "step_ratio_target": 0.61,
      "step_ratio_tolerance": 0.18,
      "max_leap_semitones": 16,
      "leap_recovery": true,
      "contours": [
        {
          "id": "wave",
          "weight": 0.45
        },
        {
          "id": "arch",
          "weight": 0.35
        },
        {
          "id": "ascending",
          "weight": 0.2
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "appoggiatura",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.38,
      "coherence_max": 0.9,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "classical_early",
    "id": "minimalist",
    "display_name": "Minimalist",
    "description": "Audible cells, gradual process, restrained harmony, and controlled phase-like variation.",
    "title": "Pattern Study",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.62
      },
      {
        "value": "3/4",
        "weight": 0.13
      },
      {
        "value": "6/8",
        "weight": 0.25
      }
    ],
    "tempo_range": [
      68,
      152
    ],
    "forms": [
      {
        "id": "process_8",
        "name": "Additive process",
        "weight": 1,
        "min_level": 2,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "cell",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "shift",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "return",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "liquidation",
            "transform": "fragment",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I",
        "IV",
        "V",
        "vi"
      ],
      "roman_degrees": {
        "I": 0,
        "IV": 3,
        "V": 4,
        "vi": 5
      },
      "transitions": {
        "I": {
          "I": 0.42,
          "IV": 0.18,
          "V": 0.18,
          "vi": 0.22
        },
        "IV": {
          "IV": 0.32,
          "I": 0.32,
          "V": 0.24,
          "vi": 0.12
        },
        "V": {
          "V": 0.28,
          "I": 0.42,
          "vi": 0.2,
          "IV": 0.1
        },
        "vi": {
          "vi": 0.28,
          "IV": 0.32,
          "I": 0.28,
          "V": 0.12
        }
      },
      "cadences": {
        "half": [
          [
            "I",
            "V"
          ]
        ],
        "authentic": [
          [
            "V",
            "I"
          ]
        ],
        "deceptive": [
          [
            "V",
            "vi"
          ]
        ],
        "plagal": [
          [
            "IV",
            "I"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "half": 0.5,
          "deceptive": 0.5
        },
        "final": {
          "authentic": 0.55,
          "plagal": 0.45
        }
      },
      "licensed_retrogressions": [
        "V>IV"
      ]
    },
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.25,
        "min_level": 1
      },
      {
        "id": "alberti",
        "weight": 0.45,
        "min_level": 3
      },
      {
        "id": "broken_octave",
        "weight": 0.3,
        "min_level": 5
      }
    ],
    "rhythm_cells": [
      {
        "id": "q",
        "meter": "simple",
        "min_level": 1,
        "weight": 0.5
      },
      {
        "id": "ee",
        "meter": "simple",
        "min_level": 2,
        "weight": 1.4
      },
      {
        "id": "ssss",
        "meter": "simple",
        "min_level": 7,
        "weight": 1.2
      },
      {
        "id": "cdq",
        "meter": "compound",
        "min_level": 4,
        "weight": 0.5
      },
      {
        "id": "ceee",
        "meter": "compound",
        "min_level": 4,
        "weight": 1.4
      }
    ],
    "melody": {
      "step_ratio_target": 0.74,
      "step_ratio_tolerance": 0.13,
      "max_leap_semitones": 12,
      "leap_recovery": true,
      "contours": [
        {
          "id": "wave",
          "weight": 0.5
        },
        {
          "id": "ascending",
          "weight": 0.25
        },
        {
          "id": "descending",
          "weight": 0.25
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor"
      ]
    },
    "expression": {
      "dynamics": [
        "p",
        "mp",
        "mf",
        "f"
      ],
      "articulations": [
        "legato",
        "staccato"
      ],
      "hairpin": true,
      "ornaments": {
        "allowed": [],
        "min_level": 10,
        "density": 0
      }
    },
    "validator": {
      "coherence_min": 0.5,
      "coherence_max": 0.98,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "folk",
    "id": "pop_contemporary",
    "display_name": "Contemporary pop",
    "description": "Loop harmony, hook repetition, sectional lift, and clean rhythmic identity.",
    "title": "Song Study",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.82
      },
      {
        "value": "6/8",
        "weight": 0.18
      }
    ],
    "tempo_range": [
      64,
      148
    ],
    "forms": [
      {
        "id": "pop_8",
        "name": "Verse–refrain",
        "weight": 0.55,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "verse",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "verse_answer",
            "transform": "reharmonize",
            "cadence": "deceptive"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "hook",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "tag",
            "transform": "fragment",
            "cadence": "plagal"
          }
        ]
      },
      {
        "id": "pop_16",
        "name": "Verse–pre-chorus–chorus",
        "weight": 0.45,
        "min_level": 4,
        "bars": 16,
        "units": [
          {
            "bars": [
              0,
              3
            ],
            "role": "verse",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              4,
              7
            ],
            "role": "verse_variation",
            "transform": "reharmonize",
            "cadence": "deceptive"
          },
          {
            "bars": [
              8,
              11
            ],
            "role": "pre_chorus",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": "half"
          },
          {
            "bars": [
              12,
              15
            ],
            "role": "chorus",
            "transform": "exact",
            "cadence": "plagal"
          }
        ]
      }
    ],
    "harmony": {
      "vocabulary": [
        "I",
        "ii",
        "IV",
        "V",
        "vi"
      ],
      "roman_degrees": {
        "I": 0,
        "ii": 1,
        "IV": 3,
        "V": 4,
        "vi": 5
      },
      "transitions": {
        "I": {
          "V": 0.34,
          "vi": 0.36,
          "IV": 0.3
        },
        "ii": {
          "V": 0.68,
          "IV": 0.32
        },
        "IV": {
          "I": 0.24,
          "V": 0.42,
          "vi": 0.34
        },
        "V": {
          "I": 0.42,
          "vi": 0.38,
          "IV": 0.2
        },
        "vi": {
          "IV": 0.44,
          "I": 0.22,
          "V": 0.22,
          "ii": 0.12
        }
      },
      "cadences": {
        "half": [
          [
            "ii",
            "V"
          ],
          [
            "IV",
            "V"
          ]
        ],
        "authentic": [
          [
            "V",
            "I"
          ]
        ],
        "deceptive": [
          [
            "V",
            "vi"
          ]
        ],
        "plagal": [
          [
            "IV",
            "I"
          ]
        ]
      },
      "cadence_weights": {
        "internal": {
          "deceptive": 0.55,
          "half": 0.3,
          "plagal": 0.15
        },
        "final": {
          "plagal": 0.45,
          "authentic": 0.3,
          "deceptive": 0.25
        }
      },
      "licensed_retrogressions": [
        "V>IV"
      ]
    },
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.45,
        "min_level": 1
      },
      {
        "id": "block_chord",
        "weight": 0.2,
        "min_level": 1
      },
      {
        "id": "broken_octave",
        "weight": 0.35,
        "min_level": 4
      }
    ],
    "melody": {
      "step_ratio_target": 0.7,
      "step_ratio_tolerance": 0.15,
      "max_leap_semitones": 14,
      "leap_recovery": true,
      "contours": [
        {
          "id": "arch",
          "weight": 0.35
        },
        {
          "id": "wave",
          "weight": 0.4
        },
        {
          "id": "ascending",
          "weight": 0.25
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.55,
      "coherence_max": 0.96,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "classical_early",
    "id": "ragtime",
    "display_name": "Ragtime",
    "description": "Syncopated right-hand cells over a steady stride-derived bass pattern.",
    "title": "Ragtime Study",
    "enabled": true,
    "meters": [
      {
        "value": "2/4",
        "weight": 0.75
      },
      {
        "value": "4/4",
        "weight": 0.25
      }
    ],
    "tempo_range": [
      72,
      132
    ],
    "forms": [
      {
        "id": "rag_strain_8",
        "name": "Ragtime strain",
        "weight": 1,
        "min_level": 4,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "riff",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "sequence",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": "half"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "return",
            "transform": "exact",
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "tag",
            "transform": "fragment",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "lh_textures": [
      {
        "id": "root_fifth",
        "weight": 0.2,
        "min_level": 4
      },
      {
        "id": "stride",
        "weight": 0.8,
        "min_level": 6
      }
    ],
    "rhythm_cells": [
      {
        "id": "q",
        "meter": "simple",
        "min_level": 1,
        "weight": 0.4
      },
      {
        "id": "ee",
        "meter": "simple",
        "min_level": 2,
        "weight": 0.7
      },
      {
        "id": "eqe",
        "meter": "simple",
        "min_level": 4,
        "weight": 1.4
      },
      {
        "id": "edq",
        "meter": "simple",
        "min_level": 4,
        "weight": 1.2
      },
      {
        "id": "sde",
        "meter": "simple",
        "min_level": 7,
        "weight": 0.8
      }
    ],
    "melody": {
      "step_ratio_target": 0.62,
      "step_ratio_tolerance": 0.16,
      "max_leap_semitones": 15,
      "leap_recovery": true,
      "contours": [
        {
          "id": "wave",
          "weight": 0.5
        },
        {
          "id": "ascending",
          "weight": 0.25
        },
        {
          "id": "arch",
          "weight": 0.25
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.5,
      "coherence_max": 0.94,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  },
  {
    "schema_version": 1,
    "version": "1.0.0",
    "extends": "classical_early",
    "id": "romantic",
    "display_name": "Romantic",
    "description": "Longer arches, expressive chromatic color, broader accompaniment, and delayed closure.",
    "title": "Lyric Piece",
    "enabled": true,
    "meters": [
      {
        "value": "4/4",
        "weight": 0.45
      },
      {
        "value": "3/4",
        "weight": 0.4
      },
      {
        "value": "6/8",
        "weight": 0.15
      }
    ],
    "tempo_range": [
      48,
      132
    ],
    "forms": [
      {
        "id": "romantic_8",
        "name": "Lyric period",
        "weight": 1,
        "min_level": 1,
        "bars": 8,
        "units": [
          {
            "bars": [
              0,
              1
            ],
            "role": "opening",
            "transform": "motif",
            "cadence": null
          },
          {
            "bars": [
              2,
              3
            ],
            "role": "yearning",
            "transform": "expand_intervals",
            "cadence": "deceptive"
          },
          {
            "bars": [
              4,
              5
            ],
            "role": "climax",
            "transform": "transpose_diatonic",
            "transform_value": 1,
            "cadence": null
          },
          {
            "bars": [
              6,
              7
            ],
            "role": "release",
            "transform": "fragment",
            "cadence": "authentic"
          }
        ]
      }
    ],
    "lh_textures": [
      {
        "id": "block_chord",
        "weight": 0.15,
        "min_level": 1
      },
      {
        "id": "alberti",
        "weight": 0.2,
        "min_level": 3
      },
      {
        "id": "broken_octave",
        "weight": 0.65,
        "min_level": 5
      }
    ],
    "melody": {
      "step_ratio_target": 0.68,
      "step_ratio_tolerance": 0.15,
      "max_leap_semitones": 15,
      "leap_recovery": true,
      "contours": [
        {
          "id": "arch",
          "weight": 0.62
        },
        {
          "id": "wave",
          "weight": 0.25
        },
        {
          "id": "ascending",
          "weight": 0.13
        }
      ],
      "non_chord_tones": [
        "passing",
        "neighbor",
        "appoggiatura",
        "suspension",
        "escape"
      ]
    },
    "validator": {
      "coherence_min": 0.38,
      "coherence_max": 0.91,
      "forbid_outer_parallels": false
    },
    "provenance": {
      "model": "bootstrap-awaiting-corpus",
      "corpus_snapshot": null
    }
  }
];
