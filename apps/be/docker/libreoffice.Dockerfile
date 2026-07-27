# Headless LibreOffice Calc for report → PDF conversion.
#
# Pinned to the same Debian release the droplet runs, because Calc's print
# behaviour is NOT stable across versions: LibreOffice 7.4 (bookworm)
# honours the `fitToWidth` flags ExcelJS writes, while 26.2 from the
# Homebrew cask ignores them and prints column strips instead. Running the
# same container locally and in production is the only way the page counts
# a developer sees match the ones the sales team gets.
#
# No Java, no GUI, no Writer/Impress: ~360 MB on top of the base.
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-calc libreoffice-core fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*
