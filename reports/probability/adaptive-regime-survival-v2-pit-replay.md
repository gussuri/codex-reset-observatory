# Adaptive Regime Survival v2 point-in-time replay

- Mode: retrospective PIT replay, not prospective or saved v2 forecasts
- Origins: 127/127; mature rows are horizon-specific
- v1 replay: passed; max final error 0; max baseline error 0
- Publication gate: passed

| Horizon | Slice | n v1/v2 | Brier v1 | Brier v2 | Log loss v1 | Log loss v2 |
|---:|---|---:|---:|---:|---:|---:|
| 12h | all | 125/125 | 0.131356 | 0.125088 | 0.417234 | 0.398261 |
| 12h | campaign | 74/74 | 0.156118 | 0.153317 | 0.485797 | 0.477791 |
| 12h | preCampaign | 51/51 | 0.095426 | 0.084129 | 0.317749 | 0.282865 |
| 12h | recent7 | 22/22 | 0.172896 | 0.161525 | 0.527426 | 0.484924 |
| 12h | noNotice | 112/112 | 0.114280 | 0.107285 | 0.377924 | 0.356749 |
| 12h | ageUnder24h | 50/50 | 0.060030 | 0.060755 | 0.233603 | 0.237537 |
| 12h | forcedOnlySensitivity | 125/125 | 0.127762 | 0.121248 | 0.400619 | 0.381823 |
| 12h | nonoverlap | 57/57 | 0.134859 | 0.129013 | 0.416999 | 0.397175 |
| 24h | all | 124/124 | 0.221679 | 0.204967 | 0.653318 | 0.611710 |
| 24h | campaign | 73/73 | 0.246564 | 0.232765 | 0.694884 | 0.658905 |
| 24h | preCampaign | 51/51 | 0.186058 | 0.165177 | 0.593821 | 0.544155 |
| 24h | recent7 | 21/21 | 0.335988 | 0.282658 | 0.907974 | 0.760982 |
| 24h | noNotice | 111/111 | 0.209977 | 0.191308 | 0.616273 | 0.569791 |
| 24h | ageUnder24h | 49/49 | 0.169498 | 0.161081 | 0.531309 | 0.504535 |
| 24h | forcedOnlySensitivity | 124/124 | 0.226646 | 0.204892 | 0.667270 | 0.612977 |
| 24h | nonoverlap | 34/34 | 0.155900 | 0.140649 | 0.483729 | 0.449407 |
| 48h | all | 121/121 | 0.253813 | 0.230399 | 0.738247 | 0.692618 |
| 48h | campaign | 70/70 | 0.227303 | 0.208789 | 0.639954 | 0.601638 |
| 48h | preCampaign | 51/51 | 0.290201 | 0.260059 | 0.873159 | 0.817493 |
| 48h | recent7 | 18/18 | 0.227336 | 0.139126 | 0.619885 | 0.436478 |
| 48h | noNotice | 109/109 | 0.239278 | 0.213285 | 0.668166 | 0.617514 |
| 48h | ageUnder24h | 49/49 | 0.254946 | 0.213614 | 0.701466 | 0.616011 |
| 48h | forcedOnlySensitivity | 121/121 | 0.307215 | 0.256779 | 0.893167 | 0.775561 |
| 48h | nonoverlap | 18/18 | 0.271223 | 0.239004 | 0.786407 | 0.719892 |
| 72h | all | 118/118 | 0.214912 | 0.202663 | 0.710786 | 0.690682 |
| 72h | campaign | 67/67 | 0.124986 | 0.127587 | 0.417682 | 0.424709 |
| 72h | preCampaign | 51/51 | 0.333049 | 0.301294 | 1.095846 | 1.040098 |
| 72h | recent7 | 15/15 | 0.102749 | 0.058065 | 0.347358 | 0.245539 |
| 72h | noNotice | 106/106 | 0.192811 | 0.179176 | 0.562618 | 0.540238 |
| 72h | ageUnder24h | 46/46 | 0.201061 | 0.177354 | 0.587900 | 0.535451 |
| 72h | forcedOnlySensitivity | 118/118 | 0.333833 | 0.277184 | 1.102021 | 0.917784 |
| 72h | nonoverlap | 12/12 | 0.269456 | 0.259145 | 0.936387 | 0.922158 |

## Gate checks

- PASS: fullBrierImproves24h
- PASS: fullBrierImproves48h
- PASS: campaignBrierImproves24h
- PASS: campaignBrierImproves48h
- PASS: noNoticeBrierImproves24h
- PASS: noNoticeBrierImproves48h
- PASS: preCampaignDegradation24hWithin005
- PASS: preCampaignDegradation48hWithin005
- PASS: campaignLogLossImproves24h
- PASS: campaignLogLossImproves48h
- PASS: fullLogLossNoWorse24h
- PASS: fullLogLossNoWorse48h

## Reset-cycle bootstrap

```json
{
  "24": {
    "all": {
      "groups": 12,
      "draws": 2000,
      "deltaBrier": -0.016711756438535477,
      "ci95": [
        -0.03647005743198559,
        -0.0027092999628756578
      ],
      "pV2Better": 0.991
    },
    "campaign": {
      "groups": 10,
      "draws": 2000,
      "deltaBrier": -0.013798898208045966,
      "ci95": [
        -0.043951248086906654,
        0.0028792066239082393
      ],
      "pV2Better": 0.933
    },
    "noNotice": {
      "groups": 12,
      "draws": 2000,
      "deltaBrier": -0.01866898917458017,
      "ci95": [
        -0.04400042319877774,
        -0.0030571673343062046
      ],
      "pV2Better": 0.99
    }
  },
  "48": {
    "all": {
      "groups": 12,
      "draws": 2000,
      "deltaBrier": -0.023414814688851628,
      "ci95": [
        -0.04391807476599175,
        -0.010766811913143735
      ],
      "pV2Better": 0.9995
    },
    "campaign": {
      "groups": 10,
      "draws": 2000,
      "deltaBrier": -0.018514155627618042,
      "ci95": [
        -0.05290876602160357,
        0.0044567232699260235
      ],
      "pV2Better": 0.9425
    },
    "noNotice": {
      "groups": 12,
      "draws": 2000,
      "deltaBrier": -0.0259925924527619,
      "ci95": [
        -0.04767183497160531,
        -0.011546401021372716
      ],
      "pV2Better": 1
    }
  }
}
```

## Limitations

- Rows are retrospective PIT replays from saved v1 boundary and policy audits, not saved v2 forecasts or prospective evidence.
- The canonical reset audit may omit unobserved real-world events; overlapping six-hour origins are dependent.
- Reset-cycle bootstrap uncertainty does not remove model-selection uncertainty.
