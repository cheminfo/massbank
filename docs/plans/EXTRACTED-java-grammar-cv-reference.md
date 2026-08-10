# Authoritative CVs extracted from massbank-lib 1.0.17 (Java)

Source: `~/.m2/repository/io/github/massbank/massbank-lib/1.0.17/massbank-lib-1.0.17.jar`
Method: `javap -v -p massbank/RecordParserDefinition.class` constant pool + jar resources.
The Java is the behavioral source of truth per repo CLAUDE.md. Extracted 2026-07-26.

> **METHOD WARNING (corrected 2026-07-26).** The first pass read the constant pool in
> order. The pool **de-duplicates strings**, so any member that also appears in an
> earlier list is silently absent. Two real omissions were found this way and are fixed
> below: `CAPILLARY_VOLTAGE` (also in the MS list) and the analyzer token `B` (also a
> chemical element symbol). **Do not regenerate this file from pool order.** Reconstruct
> each `def(name, ...)` block from the `javap -c` instruction stream instead.

## LICENSE (recordformat/license.ini — verbatim)

````
CC0
CC BY-NC-ND
CC BY-NC-SA
CC BY-NC
CC BY-SA
CC BY
dl-de/by-2-0```
## CH$LINK databases (recordformat/ch_link.ini — verbatim)
````

CAS
CAYMAN
CHEBI
CHEMBL
ChemOnt
CHEMPDB
CHEMSPIDER
COMPTOX
HMDB
INCHIKEY
KAPPAVIEW
KEGG
KNAPSACK
LIPIDBANK
LIPIDMAPS
NIKKAJI
PUBCHEM
ZINC
ChemOnt```

## MS_TYPE

```
MSn
MS5
MS4
MS3
MS2
MS
```

## ION_MODE

```
POSITIVE
NEGATIVE
```

## AC$INSTRUMENT_TYPE — ionisation tokens

```
APCI
APPI
EI
ESI
FAB
MALDI
FD
CI
FI
SI
```

## AC$INSTRUMENT_TYPE — analyzer tokens

```
B
E
FT
IT
Q
TOF
```

`B` (magnetic sector) was missing from the first extraction — pool de-duplication, since
`B` is also an element symbol. Verified at `ldc_w // String B` @6255, immediately inside
`def("ac_instrument_type_analyzer", ...)` @6252. One or more analyzer tokens concatenate
without a separator (`.plus()`), e.g. `QQ`, `QTOF`, `BE`.

## AC$MASS_SPECTROMETRY recommended subtags (free subtags = WARNING, not error)

```
ACTIVATION_PARAMETER
ACTIVATION_TIME
ATOM_GUN_CURRENT
AUTOMATIC_GAIN_CONTROL
BOMBARDMENT
CAPILLARY_TEMPERATURE
CAPILLARY_VOLTAGE
CDL_SIDE_OCTOPOLES_BIAS_VOLTAGE
CDL_TEMPERATURE
COLLISION_ENERGY
COLLISION_GAS
DATAFORMAT
DATE
DESOLVATION_GAS_FLOW
DESOLVATION_TEMPERATURE
DRY_GAS_FLOW
DRY_GAS_TEMP
FRAGMENT_VOLTAGE
GAS_PRESSURE
HELIUM_FLOW
INTERFACE_VOLTAGE
IONIZATION
IONIZATION_ENERGY
IONIZATION_POTENTIAL
IONIZATION_VOLTAGE
ION_GUIDE_PEAK_VOLTAGE
ION_GUIDE_VOLTAGE
ION_SOURCE_TEMPERATURE
ION_SPRAY_VOLTAGE
ISOLATION_WIDTH
IT_SIDE_OCTOPOLES_BIAS_VOLTAGE
LASER
LENS_VOLTAGE
MASS_ACCURACY
MASS_RANGE_M/Z
MATRIX
NEBULIZER
NEBULIZING_GAS
NEEDLE_VOLTAGE
OCTPOLE_VOLTAGE
ORIFICE_TEMP
ORIFICE_TEMPERATURE
ORIFICE_VOLTAGE
PEAK_WIDTH
PROBE_TIP
REAGENT_GAS
RESOLUTION
RESOLUTION_SETTING
RING_VOLTAGE
SAMPLE_DRIPPING
SCANNING
SCANNING_CYCLE
SCANNING_RANGE
SCAN_RANGE_M/Z
SKIMMER_VOLTAGE
SOURCE_TEMPERATURE
SPRAY_CURRENT
SPRAY_VOLTAGE
TUBE_LENS_VOLTAGE
```

## AC$CHROMATOGRAPHY recommended subtags (25 members)

```
ANALYTICAL_TIME
CAPILLARY_VOLTAGE
COLUMN_NAME
COLUMN_PRESSURE
COLUMN_TEMPERATURE
FLOW_GRADIENT
FLOW_RATE
INJECTION_TEMPERATURE
INTERNAL_STANDARD
INTERNAL_STANDARD_MT
NAPS_RTI
MIGRATION_TIME
OVEN_TEMPERATURE
PRECONDITIONING
RETENTION_INDEX
RETENTION_TIME
RUNNING_BUFFER
RUNNING_VOLTAGE
SAMPLE_INJECTION
SAMPLING_CONE
SHEATH_LIQUID
SOLVENT
TIME_PROGRAM
TRANSFARLINE_TEMPERATURE
WASHING_BUFFER
adduct_token
ACN
FA
adduct
precursor_type
ion_type
[M]+*
[M]++
[M]+
[M+H]+,[M-H2O+H]+
[M+H]+
[M+2H]++
[2M+H]+
[M+Li]+*
[M-H+Li]+*
[M+Na]+*
```

## MS$FOCUSED_ION subtags

```
BASE_PEAK
DERIVATIVE_FORM
DERIVATIVE_MASS
DERIVATIVE_TYPE
FULL_SCAN_FRAGMENT_ION_PEAK
PRECURSOR_M/Z
PRECURSOR_INTENSITY
ION_TYPE
PRECURSOR_TYPE
```

## PRECURSOR_TYPE / adduct enumerated list (CLOSED in Java)

```
[2M-H-C6H10O5]-
[2M-H-CO2]-
[2M-H]-
[2M+H]+
[2M+Na]+
[M-2H]-
[M-2H]--
[M-2H+H2O]-
[M-2H2O+H]+
[M-2H2O+H]+,[M-H2O+H]+
[M-3]+,[M-H2O+H]+
[M-C2H3O]-
[M-C3H7O2]-
[M-CH3]-
[M-H-C6H10O5]-
[M-H-CO2-2HF]-
[M-H-CO2]-
[M-H]-
[M-H]-/[M-Ser]-
[M-H]+
[M-H+Li]+*
[M-H+Na]+
[M-H+Na]+*
[M-H+OH]-
[M-H2O+H]+
[M-H2O+H]+,[M-2H2O+H]+
[M-OH]+
[M]-
[M]+
[M]+*
[M]++
[M+15]+
[M+2H]++
[M+2Na-H]+
[M+CH3]+
[M+CH3COO]-
[M+CH3COO]-/[M-CH3]-
[M+CH3COOH-H]-
[M+H-C12H20O9]+
[M+H-C6H10O4]+
[M+H-C6H10O5]+
[M+H-H2O]+
[M+H]+
[M+H]+,[M-H2O+H]+
[M+HCOO]-
[M+K-2H]-
[M+K]+
[M+Li]+*
[M+Na]+
[M+Na]+*
[M+NH3+H]+
[M+NH4]+
```
