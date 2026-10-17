# Writes ASC_KEY_P8 to KEY_PATH as the PEM file Xcode expects, whichever way
# it was pasted: the .p8 file as is, with Windows line endings, on one line,
# with "\n" written out, without the BEGIN/END lines, in quotes, or as the
# base64 of the whole file. Never prints the key.
import base64, os, re, sys

def fail(msg):
    print(f"::error::ASC_KEY_P8 {msg} Paste the whole AuthKey_XXXXXXXXXX.p8 file into the secret (on a Mac: pbcopy < AuthKey_XXXXXXXXXX.p8).")
    sys.exit(1)

s = os.environ.get('ASC_KEY_P8', '').replace('\r', '').replace('\\n', '\n').strip().strip('"\'').strip()
if not s:
    fail('is empty.')
if 'BEGIN' not in s:
    try:
        whole = base64.b64decode(re.sub(r'\s', '', s), validate=True).decode('utf-8')
        if 'BEGIN' in whole:
            s = whole
    except Exception:
        pass
m = re.search(r'-----BEGIN ([A-Z ]+)-----(.*?)-----END ([A-Z ]+)-----', s, re.S)
if 'BEGIN' in s and not m:
    fail('has a BEGIN line but no matching END line.')
label = m.group(1) if m else 'PRIVATE KEY'
if 'PRIVATE KEY' not in label:
    fail(f'holds a {label.lower()}, not a private key.')
body = re.sub(r'[^A-Za-z0-9+/=]', '', m.group(2) if m else s)
try:
    der = base64.b64decode(body, validate=True)
except Exception:
    fail('is not a key: its text is not base64.')
if len(der) < 64:
    fail('is too short to be a key; it may be the Key ID or Issuer ID instead.')
lines = '\n'.join(body[i:i + 64] for i in range(0, len(body), 64))
with open(os.environ['KEY_PATH'], 'w') as f:
    f.write(f'-----BEGIN {label}-----\n{lines}\n-----END {label}-----\n')
