# How Paynowlah checks its PayNow codes

A PayNow QR code is a line of text in the EMVCo "tag, length, value" format,
ending in a checksum. Paynowlah builds that text in `src/lib/paynow.ts`, draws
it in `src/lib/qr-image.ts`, and reads it back in `src/lib/import-qr.ts`.

## What Paynowlah writes

| Meaning | Field |
| --- | --- |
| Scheme | `26/00 = SG.PAYNOW` |
| Payee type | `26/01`: `0` mobile, `2` UEN, `1` NRIC/FIN |
| Payee | `26/02`: `+65…` mobile, UEN, or NRIC/FIN |
| Payer may change the amount | `26/03`: `1` yes, `0` no |
| Expiry (optional) | `26/04 = yyyyMMddHHmmss`, Singapore time |
| Reusable code | `01 = 11` |
| Category, currency, country | `52 = 0000`, `53 = 702`, `58 = SG` |
| Amount (optional) | `54`, always two decimals, in dollars |
| Merchant name | `59 = NA`: the bank shows the registered payee name |
| Reference (optional) | `62/01`, up to 25 plain characters |
| Checksum | `63`: CRC-16/CCITT-FALSE, start `FFFF`, polynomial `1021`, uppercase hex, over all text including `6304` |

Optional fields are left out, not written blank. A reference that is too long
or has non-plain characters is rejected, never silently changed.

## Automated checks

Run from the workspace root:

```sh
pnpm --filter @workspace/paynowlah test
pnpm --filter @workspace/paynowlah run typecheck
```

The tests:

- Compare against fixed example codes written outside this app (with made-up
  businesses), field by field, and against the standard `123456789 → 29B1`
  checksum vector.
- Read codes with a separate, strict field reader and a separate checksum
  implementation, so the encoder never checks its own output.
- Cover mobile, UEN and NRIC/FIN payees; open, small and large amounts; fixed
  and editable amounts; references with punctuation and at the 25-character
  limit; expiry across a Singapore year boundary; and links that round-trip
  through the address bar.
- Reject bad input instead of producing plausible-looking wrong codes.
- Render the real QR picture on a real canvas and decode it with a separate
  reader, at full size and shrunk to 360 pixels wide.
- Import: read codes back into the form, reject changed or cut-off text, and
  read a real phone photo of a screen.

## What the tests cannot prove

Decoding a picture proves the text inside is correct. It does not prove that
every bank app accepts it. Before claiming a change works with banks, scan the
new codes with real bank apps (without paying) and check:

- The bank shows the right payee name.
- Fixed, editable and empty amounts behave as set.
- The reference appears exactly as typed.
- Expired and unexpired codes, and codes with no expiry.
- Codes saved as pictures and imported from the photo library, as well as
  codes scanned from another screen.

Known bank behaviour: references are locked for UEN payees and editable for
mobile payees, and some bank apps refuse codes that pay to an NRIC/FIN.

Paynowlah never confirms payments. A saved picture cannot be withdrawn, and
anyone with a link can change its details.
