"""Add new columns to existing database for phase 1 enhancements."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.app.config import DATA

def migrate():
    db_path = DATA / 'library.db'
    if not db_path.exists():
        print('Database does not exist, skipping migration')
        return

    from backend.app.migrations import migrate_database
    print('Upgraded:', migrate_database(db_path))

if __name__ == '__main__':
    migrate()
