"""Seed initial parish/source rows."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_seed_initial_parishes"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Southeast Rochester Catholic Community',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Our Lady of Lourdes / Saint Anne Church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Our Lady Queen of Peace & St. Thomas More',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'St. John of Rochester',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'St. Pius X Church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'St. Mark''s Church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Saint Kateri Parsh',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Holy Spirit / St. Joseph''s',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Our Mother of Sorrows Holy Cross Catholic Community',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'St. Lawrence Chuch',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'Sacred Heart Cathedral',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish(name, created_at)
        VALUES (
            'St. Charles Borromeo Church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(name) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'ecatholic',
            'https://southeastrochestercatholics.org',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Southeast Rochester Catholic Community'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'ecatholic',
            'https://olqpstm.com',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Our Lady Queen of Peace & St. Thomas More'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'ecatholic',
            'https://stjohnfairport.org',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'St. John of Rochester'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-pius-x-church-14624',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'St. Pius X Church'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-marks-church-14612',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'St. Mark''s Church'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-kateri-tekakwitha-parish-14617',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Saint Kateri Parsh'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-josephs-catholic-church-and-church-of-the-holy-spirit',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Holy Spirit / St. Joseph''s'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'our-mother-of-sorrows-church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Our Mother of Sorrows Holy Cross Catholic Community'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-lawrence-church-14626',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'St. Lawrence Chuch'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'the-cathedral-community',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Sacred Heart Cathedral'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'st-charles-borromeo-church-14616',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'St. Charles Borromeo Church'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO parish_source(parish_id, type, provider_id, created_at)
        SELECT
            p.id,
            'parishes-online',
            'our-lady-of-lourdes-saint-anne-church',
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM parish p
        WHERE p.name = 'Our Lady of Lourdes / Saint Anne Church'
        ON CONFLICT(parish_id, type, provider_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM parish_source
        WHERE ((
              type = 'ecatholic'
          AND provider_id = 'https://southeastrochestercatholics.org'
        ) OR (
              type = 'ecatholic'
          AND provider_id = 'https://olqpstm.com/'
        ) OR (
              type = 'ecatholic'
          AND provider_id = 'https://stjohnfairport.org/'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'our-lady-of-lourdes-saint-anne-church'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-pius-x-church-14624'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-marks-church-14612'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-kateri-tekakwitha-parish-14617'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-josephs-catholic-church-and-church-of-the-holy-spirit'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'our-mother-of-sorrows-church'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-lawrence-church-14626'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'the-cathedral-community'
        ) OR (
              type = 'parishes-online'
          AND provider_id = 'st-charles-borromeo-church-14616'
        ))
          AND parish_id IN (
              SELECT id
              FROM parish
              WHERE name IN (
                  'Southeast Rochester Catholic Community',
                  'Our Lady of Lourdes / Saint Anne Church',
                  'Our Lady Queen of Peace & St. Thomas More',
                  'St. John of Rochester',
                  'St. Pius X Church',
                  'St. Mark''s Church',
                  'Saint Kateri Parsh',
                  'Holy Spirit / St. Joseph''s',
                  'Our Mother of Sorrows Holy Cross Catholic Community',
                  'St. Lawrence Chuch',
                  'Sacred Heart Cathedral',
                  'St. Charles Borromeo Church'
              )
          )
        """
    )
    op.execute(
        """
        DELETE FROM parish
        WHERE name IN (
            'Southeast Rochester Catholic Community',
            'Our Lady of Lourdes / Saint Anne Church',
            'Our Lady Queen of Peace & St. Thomas More',
            'St. John of Rochester',
            'St. Pius X Church',
            'St. Mark''s Church',
            'Saint Kateri Parsh',
            'Holy Spirit / St. Joseph''s',
            'Our Mother of Sorrows Holy Cross Catholic Community',
            'St. Lawrence Chuch',
            'Sacred Heart Cathedral',
            'St. Charles Borromeo Church'
        )
        """
    )

