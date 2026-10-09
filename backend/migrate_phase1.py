"""Add new columns to existing database for phase 1 enhancements."""
import sqlite3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.app.config import DATA

def migrate():
    db_path = DATA / 'library.db'
    if not db_path.exists():
        print('Database does not exist, skipping migration')
        return

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # Get existing columns
    cursor.execute("PRAGMA table_info(photos)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    # Columns to add
    new_columns = [
        ('gps_altitude', 'REAL'),
        ('rating', 'INTEGER'),
        ('color_label', 'TEXT'),
        ('face_data', 'TEXT'),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing_columns:
            print(f'Adding column: {col_name}')
            cursor.execute(f'ALTER TABLE photos ADD COLUMN {col_name} {col_type}')
        else:
            print(f'Column already exists: {col_name}')

    # Create face_persons table if not exists
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS face_persons (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE,
            representative_encoding BLOB,
            photo_count INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
        )
    ''')

    conn.commit()
    conn.close()
    print('Migration completed successfully')

if __name__ == '__main__':
    migrate()
