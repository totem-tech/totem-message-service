STORAGE_PATH="string: path to the JSON file's directory. Can be both relative or absolute path. Relative path must be relative to the projects root directory." \
FILE_NAME="string: JSON input filename" \
SECRET="string (hex): one of the 3: secretKey, keyData or encoded hex" \
__________OPTIONAL_VARIABLES________="" \
RECIPIENT_PUBLIC_KEY="string (hex): required for BOX encryption. If falsy, will use SecretBox encryption." \
PROPERTY_NAMES="string: comma separated string. If falsy and value is an object, all properties will be encrypted." \
FILE_NAME_OUTPUT="string: JSON output filename. If same as FILE_NAME, will override file. If falsy, will suffix `_encrypted` to the FILE_NAME as the output filename" \
NONCE="string (hex): required if values are not objects. Otherwise, will new nonce will be generated for each value" \
NONCE_KEY="string: property name to store nonce. Ignored if `@NONCE` is used. Default: `__nonce`" \
yarn run tools-encrypt