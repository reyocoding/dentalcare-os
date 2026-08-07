from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import event
import sqlite3
import os

# Local SQLite file for development; override with DATABASE_URL (e.g. a
# PostgreSQL URL from Neon/Render Postgres) in production. Tests point this
# at a temp file.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dental.db")

# We ship the psycopg3 driver (not psycopg2), so a plain "postgresql://"
# URL cannot be dialed out of the box -- SQLAlchemy's default dialect
# imports psycopg2. Normalize free-tier URLs (e.g. Neon's connection
# string) into the explicit "postgresql+psycopg://" form automatically.
if SQLALCHEMY_DATABASE_URL.startswith("postgresql://") and "+" not in SQLALCHEMY_DATABASE_URL.split("://", 1)[0]:
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace(
        "postgresql://", "postgresql+psycopg://", 1
    )

# connect_args={"check_same_thread": False} is required ONLY for SQLite
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    # Set to True to see SQL statements printed in your terminal (great for debugging)
    SQLALCHEMY_DATABASE_URL, connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency utility to get a database session per request
@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()