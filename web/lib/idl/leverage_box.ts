/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/leverage_box.json`.
 */
export type LeverageBox = {
  "address": "7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv",
  "metadata": {
    "name": "leverageBox",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Leverage Box: random leveraged positions settled between players, in real time on a MagicBlock Ephemeral Rollup"
  },
  "instructions": [
    {
      "name": "callbackBox",
      "docs": [
        "The draw. Only the MagicBlock VRF program can call it. It picks the leverage tier and",
        "the side; the side leans towards whichever is lighter so the round stays balanced."
      ],
      "discriminator": [
        94,
        39,
        101,
        140,
        58,
        157,
        132,
        209
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.owner",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelPending",
      "docs": [
        "Refunds a box whose draw never arrived."
      ],
      "discriminator": [
        74,
        87,
        109,
        242,
        64,
        192,
        151,
        71
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.owner",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "Credits the player's finished tickets to their balance. Anyone can call it for anyone."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.owner",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "configure",
      "docs": [
        "Changes the arena's timing, fee and stake limits. Takes effect from the next round, and",
        "works on Solana or in the rollup, wherever the arena currently lives."
      ],
      "discriminator": [
        245,
        7,
        108,
        117,
        95,
        196,
        54,
        217
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "arena"
          ]
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "arenaArgs"
            }
          }
        }
      ]
    },
    {
      "name": "delegateArena",
      "docs": [
        "Hands the arena to the Ephemeral Rollup. Rounds run there from now on."
      ],
      "discriminator": [
        216,
        55,
        214,
        212,
        195,
        162,
        39,
        100
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferArena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                77,
                201,
                121,
                187,
                20,
                124,
                151,
                179,
                87,
                105,
                141,
                23,
                210,
                172,
                26,
                32,
                70,
                123,
                214,
                2,
                104,
                7,
                248,
                35,
                100,
                80,
                155,
                20,
                102,
                240,
                181
              ]
            }
          }
        },
        {
          "name": "delegationRecordArena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataArena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "arg",
                "path": "feedId"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feedId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegatePlayer",
      "docs": [
        "Hands the player's account to the Ephemeral Rollup."
      ],
      "discriminator": [
        235,
        159,
        245,
        102,
        161,
        199,
        254,
        89
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                77,
                201,
                121,
                187,
                20,
                124,
                151,
                179,
                87,
                105,
                141,
                23,
                210,
                172,
                26,
                32,
                70,
                123,
                214,
                2,
                104,
                7,
                248,
                35,
                100,
                80,
                155,
                20,
                102,
                240,
                181
              ]
            }
          }
        },
        {
          "name": "delegationRecordPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "enter",
      "docs": [
        "Deposits USDC into the vault and credits the player's balance. `session` is a key the",
        "player's browser holds: it may open boxes and claim in the rollup, never withdraw."
      ],
      "discriminator": [
        139,
        49,
        209,
        114,
        88,
        91,
        77,
        134
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "session",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initArena",
      "docs": [
        "Creates the arena for one price feed, and the vault on first use."
      ],
      "discriminator": [
        24,
        246,
        252,
        176,
        155,
        175,
        123,
        124
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "arg",
                "path": "feedId"
              }
            ]
          }
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feedId",
          "type": "u32"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "arenaArgs"
            }
          }
        }
      ]
    },
    {
      "name": "leave",
      "docs": [
        "Sends the player's account back to Solana so the balance can be withdrawn."
      ],
      "discriminator": [
        59,
        234,
        148,
        108,
        107,
        149,
        173,
        112
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.owner",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openBox",
      "docs": [
        "Pays for a box and asks MagicBlock VRF for its draw. Signed by the owner or the session key."
      ],
      "discriminator": [
        225,
        220,
        10,
        104,
        173,
        151,
        214,
        199
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The owner or the player's session key; also pays, which costs nothing in the rollup"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.owner",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "tick",
      "docs": [
        "Moves the round on when it is due: locks it at the current oracle price, or settles it",
        "at the current oracle price and opens the next one. Anyone can call it; it does nothing",
        "when nothing is due, so it is safe to run on a timer."
      ],
      "discriminator": [
        92,
        79,
        44,
        8,
        101,
        80,
        63,
        15
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.feed_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "feed"
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Pays the whole balance back to the owner. Only works once the account is back on Solana."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "arena",
      "discriminator": [
        243,
        215,
        44,
        44,
        231,
        211,
        232,
        168
      ]
    },
    {
      "name": "player",
      "discriminator": [
        205,
        222,
        112,
        7,
        165,
        155,
        206,
        218
      ]
    }
  ],
  "events": [
    {
      "name": "boxOpened",
      "discriminator": [
        182,
        8,
        54,
        3,
        13,
        230,
        16,
        28
      ]
    },
    {
      "name": "roundLocked",
      "discriminator": [
        19,
        58,
        91,
        157,
        24,
        76,
        207,
        7
      ]
    },
    {
      "name": "roundSettled",
      "discriminator": [
        249,
        225,
        66,
        54,
        157,
        200,
        234,
        222
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badArgs",
      "msg": "Invalid arguments"
    },
    {
      "code": 6001,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6003,
      "name": "roundLocked",
      "msg": "This round is locked; wait for the next one"
    },
    {
      "code": 6004,
      "name": "drawPending",
      "msg": "A box is still waiting for its draw"
    },
    {
      "code": 6005,
      "name": "noDrawPending",
      "msg": "No box is waiting for a draw"
    },
    {
      "code": 6006,
      "name": "tooManyTickets",
      "msg": "Too many open tickets; claim the finished ones first"
    },
    {
      "code": 6007,
      "name": "insufficientBalance",
      "msg": "Not enough balance"
    },
    {
      "code": 6008,
      "name": "stillPlaying",
      "msg": "Tickets or a draw are still open"
    },
    {
      "code": 6009,
      "name": "nothingToClaim",
      "msg": "Nothing to withdraw"
    },
    {
      "code": 6010,
      "name": "tooEarly",
      "msg": "Not available yet"
    },
    {
      "code": 6011,
      "name": "badFeed",
      "msg": "This is not the arena's price feed"
    },
    {
      "code": 6012,
      "name": "stalePrice",
      "msg": "The price feed is stale"
    }
  ],
  "types": [
    {
      "name": "arena",
      "docs": [
        "One market: a price feed and the round currently running on it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": "u32"
          },
          {
            "name": "feed",
            "type": "pubkey"
          },
          {
            "name": "openSecs",
            "type": "u32"
          },
          {
            "name": "liveSecs",
            "type": "u32"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "minStake",
            "type": "u64"
          },
          {
            "name": "maxStake",
            "type": "u64"
          },
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "phase",
            "type": "u8"
          },
          {
            "name": "pending",
            "docs": [
              "Boxes paid for whose draw has not arrived yet"
            ],
            "type": "u32"
          },
          {
            "name": "tickets",
            "type": "u32"
          },
          {
            "name": "staked",
            "type": "u64"
          },
          {
            "name": "lockAt",
            "type": "i64"
          },
          {
            "name": "endAt",
            "type": "i64"
          },
          {
            "name": "startPrice",
            "type": "i64"
          },
          {
            "name": "buckets",
            "docs": [
              "Stake per side and leverage tier: `buckets[side][tier]`"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u64",
                    5
                  ]
                },
                2
              ]
            }
          },
          {
            "name": "history",
            "docs": [
              "Results of the last `HISTORY` rounds, indexed by `round % HISTORY`. A Vec so it is",
              "deserialized on the heap; it always holds exactly `HISTORY` entries."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "roundResult"
                }
              }
            }
          },
          {
            "name": "fees",
            "type": "u64"
          },
          {
            "name": "volume",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "arenaArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "openSecs",
            "type": "u32"
          },
          {
            "name": "liveSecs",
            "type": "u32"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "minStake",
            "type": "u64"
          },
          {
            "name": "maxStake",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "boxOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "long",
            "type": "bool"
          },
          {
            "name": "tier",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lastResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "player",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "pending",
            "type": "bool"
          },
          {
            "name": "pendingArena",
            "type": "pubkey"
          },
          {
            "name": "pendingRound",
            "type": "u64"
          },
          {
            "name": "pendingStake",
            "type": "u64"
          },
          {
            "name": "pendingAt",
            "type": "i64"
          },
          {
            "name": "tickets",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "ticket"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "last",
            "type": {
              "defined": {
                "name": "lastResult"
              }
            }
          },
          {
            "name": "boxes",
            "type": "u64"
          },
          {
            "name": "staked",
            "type": "u64"
          },
          {
            "name": "returned",
            "type": "u64"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "startPrice",
            "type": "i64"
          },
          {
            "name": "endAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "roundResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "rPpm",
            "type": "i64"
          },
          {
            "name": "owed",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "moved",
            "type": "u64"
          },
          {
            "name": "startPrice",
            "type": "i64"
          },
          {
            "name": "endPrice",
            "type": "i64"
          },
          {
            "name": "staked",
            "type": "u64"
          },
          {
            "name": "tickets",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "roundSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "rPpm",
            "type": "i64"
          },
          {
            "name": "moved",
            "type": "u64"
          },
          {
            "name": "startPrice",
            "type": "i64"
          },
          {
            "name": "endPrice",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ticket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "side",
            "docs": [
              "0 = empty slot, 1 = long, 2 = short"
            ],
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
