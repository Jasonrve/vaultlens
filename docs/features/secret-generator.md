# Secret Generator

VaultLens includes a browser-based secret generator under **Tools > Secret Generator**. It helps you create passwords, passphrases, API tokens, UUIDs, hexadecimal values, and Base64 values for use wherever you need them.

## Generate values

Choose a generator type and select **Generate values**. Passwords support length, character groups, custom characters, and ambiguous-character exclusion. Passphrases support word count, separators, and capitalization. API tokens, hex values, UUIDs, and Base64 values use browser cryptography; Base64 can be standard or URL-safe.

The generated value is displayed on the page and can be revealed, hidden, or copied. Generated values are kept in the active page and are never included in URLs or saved as history.

## Remembered options

The generator remembers the last selected options in this browser, including the generator type and its settings. Only those options are stored; generated values are not persisted.

## Generate from a secret editor

Secret value fields include a generator icon. Select a quick option such as Password, API token, UUID, Hex, or Base64 to insert a value immediately. Select **More options** for the full generator popup, including passphrases and the detailed password settings.

The popup asks you to confirm before replacing an existing value. It does not save the secret automatically; the normal editor Save action is still required.

## Security notes

Generation happens locally in the browser using its cryptographically secure random source. Do not use generated values in places where your browser or clipboard may be monitored. Copying a value makes it available to the operating system clipboard, and saving a value sends it to Vault through the authenticated VaultLens API.
