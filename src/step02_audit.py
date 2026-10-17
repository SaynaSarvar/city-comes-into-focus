"""
Step 2 - Data audit for the Istanbul hourly traffic density file.
Put this file in src/ and run from the project root:
    python src/step02_audit.py data/raw/traffic_density_202410.csv
Copy the full printed output back to Claude.
"""
import sys
import pandas as pd

path = sys.argv[1] if len(sys.argv) > 1 else "data/raw/traffic_density_202410.csv"

# 1. Raw look: first lines, to catch separator / encoding problems
print("=== FIRST 3 RAW LINES ===")
with open(path, "r", encoding="utf-8", errors="replace") as f:
    for _ in range(3):
        print(f.readline().rstrip())

# 2. Load
df = pd.read_csv(path)
df.columns = [c.strip().upper() for c in df.columns]
print("\n=== SHAPE ===", df.shape)
print("\n=== COLUMNS AND TYPES ===")
print(df.dtypes)
print("\n=== MEMORY (MB) ===", round(df.memory_usage(deep=True).sum() / 1e6, 1))

# 3. Missing values
print("\n=== MISSING VALUES PER COLUMN ===")
print(df.isna().sum())

# 4. Time coverage
df["DATE_TIME"] = pd.to_datetime(df["DATE_TIME"], errors="coerce")
print("\n=== TIME RANGE ===", df["DATE_TIME"].min(), "->", df["DATE_TIME"].max())
print("Unparseable timestamps:", df["DATE_TIME"].isna().sum())
print("Distinct hours:", df["DATE_TIME"].nunique(), "(31 days x 24 = 744 expected)")

# 5. Spatial coverage
print("\n=== GEOHASH ===")
print("Distinct geohash cells:", df["GEOHASH"].nunique())
print("Geohash lengths:", df["GEOHASH"].astype(str).str.len().value_counts().to_dict())

# 6. How many hours does each cell have? (sparsity check - very important)
hours_per_cell = df.groupby("GEOHASH")["DATE_TIME"].nunique()
print("\n=== HOURS OBSERVED PER CELL (out of 744) ===")
print(hours_per_cell.describe())
for thr in [24, 100, 300, 600]:
    print(f"Cells with >= {thr} hours: {(hours_per_cell >= thr).sum()}")

# 7. Days observed per cell
df["DAY"] = df["DATE_TIME"].dt.date
days_per_cell = df.groupby("GEOHASH")["DAY"].nunique()
print("\n=== DAYS OBSERVED PER CELL (out of 31) ===")
print(days_per_cell.describe())
print("Cells seen on >= 20 days:", (days_per_cell >= 20).sum())

# 8. Duplicates: more than one row per cell per hour?
dups = df.duplicated(subset=["GEOHASH", "DATE_TIME"]).sum()
print("\n=== DUPLICATE (cell, hour) ROWS ===", dups)

# 9. Value sanity for numeric columns
print("\n=== NUMERIC SUMMARY ===")
print(df.describe().T)

# 10. Save a compact copy for later steps
out = path.replace("raw", "processed").replace(".csv", ".parquet")
df.to_parquet(out, index=False)
print("\nSaved compact copy to:", out)
