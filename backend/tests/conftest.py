import os
import tempfile
from pathlib import Path

# Importing app.main builds the module-level app, which initializes the DB at
# PM_DB_PATH (default backend/data/pm.db). Point it at a throwaway file so test
# collection never touches the real database.
os.environ["PM_DB_PATH"] = str(Path(tempfile.mkdtemp(prefix="pm-tests-")) / "pm.db")
