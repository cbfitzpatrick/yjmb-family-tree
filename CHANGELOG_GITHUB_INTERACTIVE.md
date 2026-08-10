# Interactive site changelog

The current implementation is **v13**. See `CHANGELOG_V13.md` for active behavior.

v12's client-side answer fingerprints/PBKDF2 key wrapping are superseded. v13 validates access answers only in Worker secrets and uses authenticated server key delivery.

Earlier v3-v11 plaintext/public-card and public-Issue submission designs are also superseded and should not be used for the public deployment.
