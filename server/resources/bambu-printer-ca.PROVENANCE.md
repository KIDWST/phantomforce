# Public Bambu printer trust anchors

`bambu-printer-ca.pem` is the public certificate bundle from BambuStudio tag
`v02.08.02.61`, `resources/cert/printer.cer`:

https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/resources/cert/printer.cer

The locally installed public resource matched that exact official source after
newline normalization. The retained LF-normalized bundle's SHA-256 is
`168852cde67cd9c7648de5f95b46f7b950d1627966d2da6a968fd9ef9d034910`.
This contains public CA certificates, never device private keys or user credentials.

The monitor requires a valid CA chain and exact serial-number leaf identity.
Certificate failures remain failures; it never disables TLS verification.
