"""Seed website table from parishes CSV."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0005_seed_websites"
down_revision = "0004_add_website_table"
branch_labels = None
depends_on = None

_ROWS: list[tuple[str, str, str]] = [
    ("all-saints-corning", "All Saints Parish", "https://allsaintsparish.org"),
    ("net-catholic", "N.E.T. Catholic", "https://netcatholic.org"),
    ("southeast-rochester-catholic-community", "Southeast Rochester Catholic Community", "https://southeastrochestercatholics.org"),
    ("blessed-trinity-st-patrick", "Blessed Trinity and St. Patrick Parishes", "https://blessed-trinity-parish.org"),
    ("catholic-parishes-eastern-wayne-county", "Catholic Parishes of Eastern Wayne County", "https://www.cpewc.org"),
    ("saint-jerome", "Church of Saint Jerome", "https://stjeromerochester.org"),
    ("assumption-resurrection", "Assumption & Resurrection", "https://assumptionresurrection.org"),
    ("holy-spirit-st-josephs", "Holy Spirit & St. Joseph's", "https://holyspirit-saintjoseph.org"),
    ("nativity-seas", "Nativity of the Blessed Virgin Mary / Saint Elizabeth Ann Seton", "https://nativitybrockport.org"),
    ("transfiguration-st-catherine-mendon", "Church of the Transfiguration / St. Catherine of Siena", "https://www.transfigurationpittsford.org"),
    ("st-monica-emmanuel", "St. Monica / Emmanuel Church of the Deaf", "https://www.stmonicaofrochester.org"),
    ("good-shepherd-catholic-community", "Good Shepherd Catholic Community", "https://thegoodshepherd.cc"),
    ("holy-apostles", "Holy Apostles Church", "https://holyapostleschurchfamily.org"),
    ("our-mother-of-sorrows-holy-cross", "Our Mother of Sorrows / Holy Cross", "https://moshc.org"),
    ("holy-family-catholic-community", "Holy Family Catholic Community", "https://www.hfccwny.org"),
    ("holy-trinity-webster", "Holy Trinity Church", "https://holytrinityweb.org"),
    ("immaculate-conception-ithaca", "Immaculate Conception Church", "https://www.immconch.org"),
    ("immaculate-conception-st-bridgets", "Immaculate Conception/St. Bridget's", "https://www.immaculateconceptionrochester.org"),
    ("mary-mother-of-mercy", "The Parish of Mary, Mother of Mercy", "https://www.marymotherofmercy.com"),
    ("our-lady-of-lourdes-st-anne", "Our Lady of Lourdes + St. Anne", "https://ololsa.org"),
    ("our-lady-of-peace-geneva", "Our Lady of Peace", "https://ourladyofpeacegeneva.org"),
    ("our-lady-of-the-lakes", "Our Lady of the Lakes Catholic Community", "https://ourladyofthelakescc.org"),
    ("our-lady-of-the-valley", "Our Lady of the Valley Parish", "https://www.olv14843.org"),
    ("our-lady-of-victory-st-joseph", "Our Lady of Victory / St. Joseph", "https://olvsj.org"),
    ("our-lady-queen-of-peace-st-thomas-more", "Our Lady Queen of Peace and St. Thomas More Catholic Community", "https://olqpstm.com"),
    ("parish-of-the-holy-family", "The Parish of the Holy Family", "https://theparishoftheholyfamily.org"),
    ("most-holy-name-of-jesus", "Parish of the Most Holy Name of Jesus", "https://elmiracatholic.org"),
    ("peace-of-christ", "Peace of Christ Parish", "https://peaceofchristparish.org"),
    ("sacred-heart-auburn-cluster", "Catholic Community of Sacred Heart, St. Alphonsus, St. Ann Parish and Holy Family", "https://sacredheartauburn.org"),
    ("sacred-heart-cathedral", "Sacred Heart Cathedral", "https://sacredheartrochester.org"),
    ("saint-rita-webster", "Saint Rita", "https://www.saintritawebster.org"),
    ("ss-isidore-maria-torribia", "Ss. Isidore & Maria Torribia Parish", "https://simtparish.org"),
    ("our-lady-of-the-snow-saints-mary-and-martha", "Our Lady of the Snow / Saints Mary and Martha Parish", "https://www.stmaryauburn.org"),
    ("st-agnes-paul-rose", "St. Agnes / St. Paul of the Cross / St. Rose", "https://www.saintagnespaulrose.org"),
    ("st-benedict-parish", "St. Benedict Parish", "https://stbenedictonline.org"),
    ("st-benedicts-st-marys-lake", "St. Benedict's / St. Mary's of the Lake", "https://stmarystben.org"),
    ("st-catherine-of-siena-ithaca", "St. Catherine of Siena Church", "https://stcathofsiena.org"),
    ("st-charles-borromeo", "St. Charles Borromeo", "https://stcharlesgreece.org"),
    ("st-christopher", "St. Christopher", "https://www.stchristophersnchili.org"),
    ("st-frances-xavier-cabrini", "St. Frances Xavier Cabrini Parish", "https://cabriniroc.org"),
    ("st-francis-and-st-clare", "St. Francis and St. Clare", "https://sfscrcc.org"),
    ("st-john-of-rochester", "St. John of Rochester", "https://stjohnfairport.org"),
    ("st-john-greece", "St. John the Evangelist (Greece)", "https://www.stjohngreece.org"),
    ("st-john-spencerport", "St. John the Evangelist (Spencerport)", "https://stjohnschurchspencerport.org"),
    ("st-john-vianney", "St. John Vianney", "https://sjvbath.org"),
    ("st-kateri-tekakwitha", "St. Kateri Tekakwitha", "https://www.kateriirondequoit.org"),
    ("st-katharine-drexel-st-maximilian-kolbe", "St. Katharine Drexel Parish / St. Maximilian Kolbe Parish", "https://www.catholicparisheswwc.org"),
    ("st-lawrence", "St. Lawrence", "https://stlawrencegreeceny.org"),
    ("st-leo-the-great", "St. Leo the Great Catholic Parish", "https://stleohilton.org"),
    ("st-louis-pittsford", "St. Louis Church", "https://stlouischurch.org"),
    ("st-luke-the-evangelist", "St. Luke the Evangelist Parish", "https://www.stlukelivingstoncounty.org"),
    ("st-marianne-cope", "St. Marianne Cope", "https://www.smcrcc.org"),
    ("st-marks-greece", "St. Mark's", "https://www.stmarksgreece.com"),
    ("st-martin-de-porres", "St. Martin de Porres", "https://www.stmartinrochester.org"),
    ("st-mary-our-mother", "St. Mary Our Mother", "https://stmaryourmother.com"),
    ("st-marys-st-matthew", "St. Mary's / St. Matthew", "https://www.stsmaryandmatthew.com"),
    ("st-patricks-victor", "St. Patrick's (Victor)", "https://stpatricksvictor.org"),
    ("st-pauls-webster", "St. Paul's Roman Catholic Church", "https://www.stpaulsrcc.org"),
    ("st-peters-ontario-county", "St. Peter's Roman Catholic Parish", "https://www.stpeterparish.us"),
    ("st-pius-x-chili", "St. Pius X", "https://www.saintpiustenth.org"),
    ("st-stanislaus-kostka", "St. Stanislaus Kostka", "https://www.saintstanislausrochester.org"),
    ("st-theodores-gates", "St. Theodore's Catholic Church", "https://www.sttheodoreschurch.com"),
]


def upgrade() -> None:
    for parish_slug, parish_name, homepage_url in _ROWS:
        safe_name = parish_name.replace("'", "''")
        op.execute(
            f"""
            INSERT INTO website(homepage_url, parish_name, parish_slug)
            VALUES ('{homepage_url}', '{safe_name}', '{parish_slug}')
            ON CONFLICT(homepage_url) DO NOTHING
            """
        )


def downgrade() -> None:
    slugs = ", ".join(f"'{slug}'" for slug, _, _ in _ROWS)
    op.execute(f"DELETE FROM website WHERE parish_slug IN ({slugs})")
