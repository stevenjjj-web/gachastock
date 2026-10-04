/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kaigu_gacha.json`.
 */
export type KaiguGacha = {
  "address": "7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv",
  "metadata": {
    "name": "kaiguGacha",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "GachaStock: a blind-box protocol for tokenized US stocks on Solana"
  },
  "instructions": [
    {
      "name": "buyPacks",
      "docs": [
        "Takes payment, creates the pack and requests randomness. The full amount stays pending",
        "until the callback, so a timeout can be refunded in full."
      ],
      "discriminator": [
        136,
        30,
        10,
        209,
        228,
        139,
        105,
        138
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "The user or a relayer; pays rent and the randomness fee"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine.id",
                "account": "machine"
              }
            ]
          }
        },
        {
          "name": "curve",
          "docs": [
            "The machine's coin market; required for launchpad machines, absent for official ones."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine"
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "machine.season",
                "account": "machine"
              }
            ]
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
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "count",
          "type": "u8"
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
      "name": "callbackOpen",
      "docs": [
        "Draw callback. Callable only by the MagicBlock VRF identity; it only updates the ledgers and moves no tokens."
      ],
      "discriminator": [
        54,
        7,
        119,
        98,
        242,
        113,
        52,
        0
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
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "pack.owner",
                "account": "pack"
              },
              {
                "kind": "account",
                "path": "pack.nonce",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pack.season",
                "account": "pack"
              }
            ]
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
                "path": "pack.owner",
                "account": "pack"
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "curve",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine"
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
      "name": "claim",
      "docs": [
        "Sends the locked USDC to the user minus the settlement fee, mints the machine coins the",
        "pulls bought, closes the Pack and returns its rent. The frontend can append Jupiter swap",
        "instructions in the same transaction to turn the USDC into the pulled stock."
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
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "pack"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pack.season",
                "account": "pack"
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine"
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pack.nonce",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "pack"
          ]
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "coinMint",
          "docs": [
            "Needed only when the pack's pulls bought machine coins."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "userCoin",
          "docs": [
            "The owner's token account for the machine coin; the handler checks its mint and owner."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "coinTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "coinBuy",
      "docs": [
        "Buys the machine coin with at most `usdc_in` (fee included). Before graduation this",
        "trades on the bonding curve; the purchase that sells the last curve coin graduates the",
        "coin and the whole raise becomes its pool. After graduation it trades against that pool."
      ],
      "discriminator": [
        137,
        104,
        233,
        223,
        113,
        176,
        7,
        109
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine.id",
                "account": "machine"
              }
            ]
          }
        },
        {
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true
        },
        {
          "name": "userCoin",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "coinTokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "coinTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "usdcIn",
          "type": "u64"
        },
        {
          "name": "minCoinsOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "coinSell",
      "docs": [
        "Sells machine coins back to the curve or, after graduation, to the pool. Not affected by pause."
      ],
      "discriminator": [
        195,
        49,
        32,
        203,
        70,
        193,
        125,
        90
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine.id",
                "account": "machine"
              }
            ]
          }
        },
        {
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true
        },
        {
          "name": "userCoin",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "coinTokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "coinTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "coinsIn",
          "type": "u64"
        },
        {
          "name": "minUsdcOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMachine",
      "docs": [
        "Creates an official machine: no machine coin and no creator."
      ],
      "discriminator": [
        68,
        24,
        217,
        254,
        119,
        181,
        215,
        57
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.active_season",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "registry.machine_count",
                "account": "registry"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "machineArgs"
            }
          }
        }
      ]
    },
    {
      "name": "createSeason",
      "docs": [
        "Publishes a new season and makes it the one new machines are created under.",
        "Published seasons are immutable; existing machines keep their own season."
      ],
      "discriminator": [
        38,
        108,
        29,
        127,
        60,
        126,
        101,
        3
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.season_count",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "seasonArgs"
            }
          }
        }
      ]
    },
    {
      "name": "fundPool",
      "docs": [
        "Adds USDC to the shared prize pool. Anyone can do it; it cannot be taken back out",
        "except as prizes."
      ],
      "discriminator": [
        36,
        57,
        233,
        176,
        181,
        20,
        87,
        159
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "funderUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initVault",
      "docs": [
        "Opens the shared vault: the one prize pool and the one USDC account of the program."
      ],
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
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
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the Config. Only the program upgrade authority (multisig) may call it."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "program",
          "address": "7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "launchMachine",
      "docs": [
        "Launchpad: anyone can launch a machine and its coin. The creator picks the name,",
        "ticker, art and a stock basket from the whitelist; everything else comes from the",
        "template and nothing can be changed afterwards. The machine is open for pulls right",
        "away and plays for the shared prize pool; its coin starts on a bonding curve."
      ],
      "discriminator": [
        250,
        26,
        214,
        249,
        91,
        17,
        146,
        238
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.active_season",
                "account": "config"
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "registry.machine_count",
                "account": "registry"
              }
            ]
          }
        },
        {
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "docs": [
            "The machine coin: a classic SPL token whose only mint authority is the machine."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "machine"
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "creatorUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "coinTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "machineArgs"
            }
          }
        }
      ]
    },
    {
      "name": "refundTimeout",
      "docs": [
        "If the randomness callback times out, the pack owner gets the full payment back. Not affected by pause."
      ],
      "discriminator": [
        142,
        147,
        135,
        70,
        231,
        198,
        23,
        207
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "pack"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pack.season",
                "account": "pack"
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine"
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pack.nonce",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "pack"
          ]
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "coinMint",
          "docs": [
            "Needed only when the pack's pulls bought machine coins."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "userCoin",
          "docs": [
            "The owner's token account for the machine coin; the handler checks its mint and owner."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "coinTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "docs": [
        "Pauses new purchases, launches and coin buys; claims, refunds and coin sells keep working."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdrawCreatorFees",
      "docs": [
        "Pays a machine's accrued creator fees to its creator. Anyone can crank it."
      ],
      "discriminator": [
        8,
        30,
        213,
        18,
        121,
        105,
        129,
        222
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "machine.id",
                "account": "machine"
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "creatorUsdc",
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
    },
    {
      "name": "withdrawProtocolFees",
      "docs": [
        "Pays the protocol's accrued fees to the treasury. Anyone can crank it. No instruction",
        "can take the prize pool, locked prizes, pending payments or a coin market's USDC."
      ],
      "discriminator": [
        11,
        68,
        165,
        98,
        18,
        208,
        134,
        73
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
                  112,
                  114,
                  105,
                  122,
                  101,
                  95,
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
          "name": "vaultToken",
          "writable": true
        },
        {
          "name": "treasuryUsdc",
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
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "curve",
      "discriminator": [
        191,
        180,
        249,
        66,
        180,
        71,
        51,
        182
      ]
    },
    {
      "name": "machine",
      "discriminator": [
        25,
        102,
        22,
        13,
        58,
        243,
        138,
        79
      ]
    },
    {
      "name": "pack",
      "discriminator": [
        244,
        192,
        97,
        212,
        134,
        91,
        198,
        200
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
    },
    {
      "name": "registry",
      "discriminator": [
        47,
        174,
        110,
        246,
        184,
        182,
        252,
        218
      ]
    },
    {
      "name": "season",
      "discriminator": [
        76,
        67,
        93,
        156,
        180,
        157,
        248,
        47
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "coinTraded",
      "discriminator": [
        131,
        30,
        68,
        81,
        134,
        241,
        239,
        220
      ]
    },
    {
      "name": "machineCreated",
      "discriminator": [
        159,
        82,
        7,
        32,
        232,
        69,
        34,
        213
      ]
    },
    {
      "name": "machineGraduated",
      "discriminator": [
        119,
        144,
        172,
        235,
        255,
        64,
        120,
        124
      ]
    },
    {
      "name": "packClaimed",
      "discriminator": [
        12,
        57,
        12,
        54,
        24,
        145,
        203,
        38
      ]
    },
    {
      "name": "packOpened",
      "discriminator": [
        107,
        111,
        64,
        235,
        140,
        166,
        46,
        201
      ]
    },
    {
      "name": "packRefunded",
      "discriminator": [
        8,
        128,
        247,
        205,
        55,
        245,
        103,
        87
      ]
    },
    {
      "name": "packsBought",
      "discriminator": [
        44,
        243,
        223,
        11,
        90,
        23,
        184,
        47
      ]
    },
    {
      "name": "poolFunded",
      "discriminator": [
        164,
        221,
        242,
        68,
        164,
        64,
        24,
        214
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "New purchases are paused"
    },
    {
      "code": 6001,
      "name": "badCount",
      "msg": "Pull count must be between 1 and 10"
    },
    {
      "code": 6002,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6003,
      "name": "badStatus",
      "msg": "Pack is in the wrong status"
    },
    {
      "code": 6004,
      "name": "seasonMismatch",
      "msg": "Season mismatch"
    },
    {
      "code": 6005,
      "name": "insolvent",
      "msg": "Prize pool or token balance is insufficient"
    },
    {
      "code": 6006,
      "name": "tooEarly",
      "msg": "Timeout has not elapsed yet"
    },
    {
      "code": 6007,
      "name": "badSeason",
      "msg": "Invalid season parameters"
    },
    {
      "code": 6008,
      "name": "badProbSum",
      "msg": "Probabilities must sum to 1,000,000 ppm"
    },
    {
      "code": 6009,
      "name": "budgetExceeded",
      "msg": "Expected fixed-tier payout must be below the per-pack prize pool inflow"
    },
    {
      "code": 6010,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6011,
      "name": "nothingToWithdraw",
      "msg": "Nothing to withdraw"
    },
    {
      "code": 6012,
      "name": "badMachine",
      "msg": "Invalid machine parameters"
    },
    {
      "code": 6013,
      "name": "marketClosed",
      "msg": "This machine coin is not trading"
    },
    {
      "code": 6014,
      "name": "slippage",
      "msg": "Price moved past the slippage limit"
    },
    {
      "code": 6015,
      "name": "creatorCap",
      "msg": "The creator's allocation on the curve is used up"
    },
    {
      "code": 6016,
      "name": "earlyCap",
      "msg": "Purchase is above the limit for the first blocks after launch"
    },
    {
      "code": 6017,
      "name": "tooSmall",
      "msg": "Trade amount is too small"
    },
    {
      "code": 6018,
      "name": "badCoinAccount",
      "msg": "The machine coin accounts are missing or do not match"
    }
  ],
  "types": [
    {
      "name": "coinTraded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "isBuy",
            "type": "bool"
          },
          {
            "name": "usdc",
            "type": "u64"
          },
          {
            "name": "coins",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "docs": [
              "Unused; kept so the account layout stays stable across upgrades."
            ],
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "activeSeason",
            "type": "u16"
          },
          {
            "name": "seasonCount",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "curve",
      "docs": [
        "Coin-side state of a launchpad machine's market."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "launchSlot",
            "type": "u64"
          },
          {
            "name": "sold",
            "docs": [
              "Coins sold by the curve and still outstanding. Stays at the full curve supply after graduation."
            ],
            "type": "u64"
          },
          {
            "name": "creatorBought",
            "type": "u64"
          },
          {
            "name": "graduated",
            "docs": [
              "The curve sold out and the coin now trades against the pool."
            ],
            "type": "bool"
          },
          {
            "name": "graduatedAt",
            "type": "i64"
          },
          {
            "name": "poolCoins",
            "docs": [
              "Coin side of the post-graduation pool. These coins are minted only when bought."
            ],
            "type": "u64"
          },
          {
            "name": "rebatedCoins",
            "docs": [
              "Coins bought for players by their pulls, and the USDC that paid for them."
            ],
            "type": "u64"
          },
          {
            "name": "rebatedUsdc",
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
      "name": "machine",
      "docs": [
        "One gacha machine: a theme, a stock basket and, for launchpad machines, a coin and a",
        "creator. Machines hold no USDC themselves; the amounts below are their share of the vault."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "machineKind"
              }
            }
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "theme",
            "docs": [
              "Art / colour preset; display only."
            ],
            "type": "u8"
          },
          {
            "name": "basket",
            "docs": [
              "Indices into the season's stock whitelist."
            ],
            "type": "bytes"
          },
          {
            "name": "coinMint",
            "docs": [
              "Machine coin mint; default for official machines."
            ],
            "type": "pubkey"
          },
          {
            "name": "marketUsdc",
            "docs": [
              "USDC backing the machine coin: the curve reserve before graduation, the pool's USDC side after."
            ],
            "type": "u64"
          },
          {
            "name": "creatorAccrued",
            "type": "u64"
          },
          {
            "name": "totalPulls",
            "type": "u64"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "jackpotsWon",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "machineArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "theme",
            "type": "u8"
          },
          {
            "name": "basket",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "machineCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "coinMint",
            "type": "pubkey"
          },
          {
            "name": "launchpad",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "machineGraduated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "poolUsdc",
            "type": "u64"
          },
          {
            "name": "poolCoins",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "machineKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "official"
          },
          {
            "name": "launchpad"
          }
        ]
      }
    },
    {
      "name": "pack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "paid",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "packStatus"
              }
            }
          },
          {
            "name": "requestSlot",
            "type": "u64"
          },
          {
            "name": "lockedAmount",
            "type": "u64"
          },
          {
            "name": "coins",
            "docs": [
              "Machine coins the pulls bought for the owner; minted on claim."
            ],
            "type": "u64"
          },
          {
            "name": "results",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pullResult"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "nonce",
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
      "name": "packClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pack",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "settleFee",
            "type": "u64"
          },
          {
            "name": "coins",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "packOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pack",
            "type": "pubkey"
          },
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "results",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pullResult"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "lockedAmount",
            "type": "u64"
          },
          {
            "name": "coins",
            "type": "u64"
          },
          {
            "name": "prizePoolAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "packRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pack",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "packStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "revealed"
          }
        ]
      }
    },
    {
      "name": "packsBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pack",
            "type": "pubkey"
          },
          {
            "name": "machine",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "paid",
            "type": "u64"
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
            "name": "dryStreak",
            "type": "u16"
          },
          {
            "name": "totalPulls",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "totalWon",
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
      "name": "poolFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "prizePoolAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pullResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "value",
            "type": "u64"
          },
          {
            "name": "stockIdx",
            "docs": [
              "Index into the season's stock whitelist"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "machineCount",
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
      "name": "season",
      "docs": [
        "Economic parameters shared by machines. Immutable once published; new parameters need a",
        "new season, and every machine keeps the season it was created under."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "packPrice",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "poolBps",
            "type": "u16"
          },
          {
            "name": "settleFeeBps",
            "type": "u16"
          },
          {
            "name": "capBps",
            "type": "u16"
          },
          {
            "name": "jackpotShareBps",
            "type": "u16"
          },
          {
            "name": "pity",
            "type": "u16"
          },
          {
            "name": "timeoutSlots",
            "type": "u64"
          },
          {
            "name": "jackpotMinPool",
            "docs": [
              "The jackpot only pays while the prize pool is at least this large; below it a jackpot",
              "roll pays the best fixed tier the pool can afford."
            ],
            "type": "u64"
          },
          {
            "name": "tiers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tier"
                  }
                },
                7
              ]
            }
          },
          {
            "name": "whitelist",
            "docs": [
              "Stock mints a machine may put in its basket."
            ],
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "seasonArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "packPrice",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "poolBps",
            "type": "u16"
          },
          {
            "name": "settleFeeBps",
            "type": "u16"
          },
          {
            "name": "capBps",
            "type": "u16"
          },
          {
            "name": "jackpotShareBps",
            "type": "u16"
          },
          {
            "name": "pity",
            "type": "u16"
          },
          {
            "name": "timeoutSlots",
            "type": "u64"
          },
          {
            "name": "jackpotMinPool",
            "type": "u64"
          },
          {
            "name": "tiers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tier"
                  }
                },
                7
              ]
            }
          },
          {
            "name": "whitelist",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "tier",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "probPpm",
            "type": "u32"
          },
          {
            "name": "bonus",
            "docs": [
              "Prize-pool payout on top of the floor (USDC base units). Ignored for the jackpot tier."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "The one prize pool every machine plays for, and the only place the program holds USDC.",
        "Its token account must always hold at least the sum of the ledger fields."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": "pubkey"
          },
          {
            "name": "pending",
            "docs": [
              "Paid for packs that are still waiting for their draw."
            ],
            "type": "u64"
          },
          {
            "name": "prizePool",
            "type": "u64"
          },
          {
            "name": "locked",
            "docs": [
              "Revealed prizes that have not been claimed yet."
            ],
            "type": "u64"
          },
          {
            "name": "protocolFees",
            "type": "u64"
          },
          {
            "name": "markets",
            "docs": [
              "Sum over all machines of `market_usdc + creator_accrued`."
            ],
            "type": "u64"
          },
          {
            "name": "totalPulls",
            "type": "u64"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "jackpotsWon",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
