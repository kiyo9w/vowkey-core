# vowkey-capture

Reads the facts printed on identity documents:

- **MRZ (`mrz`):** ICAO Doc 9303 machine-readable zones on passports, cards and visas (`TD1`, `TD2`, `TD3`, `MRV-A`, `MRV-B`), with check-digit verification and OCR repair.
- **AAMVA (`aamva`):** North American driver licence and ID card PDF417 barcodes (AAMVA DL/ID CDS).
- **Vietnam CCCD (`cccd`):** Vietnamese citizen identity card (Căn cước công dân / Căn cước) QR payloads with NFC normalization and century/gender/year verification.
- **Barcodes (`barcode`):** Decodes PDF417, QR and other barcodes from document images via `rxing`.
