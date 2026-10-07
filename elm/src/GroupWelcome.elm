module GroupWelcome exposing
    ( ContextInput
    , Envelope
    , buildContext
    , ciphertextBytes
    , contextDomain
    , decodeEnvelope
    , envelopeBytes
    , ephemeralBytes
    , hkdfInfo
    , nonceBytes
    , normalizeRoom
    , plaintextBytes
    , welcomeMagic
    , welcomeVersion
    )

{-| OGW1 welcome-wrap codec (structural half) — Elm port of the pure
parts of `src/lib/e2ee/groupWelcome.ts`.

Split of responsibilities, mirroring the oracle:

  - Envelope framing (magic/version/exact sizes, canonical base64url,
    trailing-byte refusal) and the canonical welcome context decode
    here, eagerly, before anything is requested.
  - ECDH + HKDF-SHA256 + AES-GCM, the plaintext checks, the epoch-key
    commitment, and the keyring install run ports-side
    (`createGroupWelcome`): secret bytes never cross into Elm, and the
    opened epoch key is installed into the ports room keyring in the
    same call — never returned.
  - The `ogc1-…` recipient binding (welcome target vs local identity)
    is enforced by `App` before requesting an open, using the
    publisher-projected device id.

Fail-closed throughout: every negative path is `Nothing`, never a
best-effort context.

-}

import Base64Url


{-| `OGW1` envelope magic. -}
welcomeMagic : String
welcomeMagic =
    "OGW1"


{-| Envelope version byte. -}
welcomeVersion : Int
welcomeVersion =
    1


{-| Plaintext magic `OGWP1`. -}
plaintextMagic : String
plaintextMagic =
    "OGWP1"


{-| Context domain shared by HKDF salt/info and the AES-GCM AAD. -}
contextDomain : String
contextDomain =
    "ONYX-GROUP-WELCOME-CONTEXT-v1"


{-| HKDF info prefix (`…\u{0000}` is appended by the KDF, ports-side). -}
hkdfInfo : String
hkdfInfo =
    "ONYX-GROUP-WELCOME-v1"


{-| Uncompressed P-256 ephemeral key bytes. -}
ephemeralBytes : Int
ephemeralBytes =
    65


{-| AES-GCM nonce bytes. -}
nonceBytes : Int
nonceBytes =
    12


{-| `commitId` bytes. -}
commitIdBytes : Int
commitIdBytes =
    32


{-| GCM ciphertext bytes: 109-byte plaintext + 16-byte tag. -}
ciphertextBytes : Int
ciphertextBytes =
    109 + 16


{-| Exact OGW1 envelope bytes: magic(4) + version(1) + ephemeral(65) +
nonce(12) + ciphertext(125). -}
envelopeBytes : Int
envelopeBytes =
    4 + 1 + ephemeralBytes + nonceBytes + ciphertextBytes


{-| Fixed OGW1 plaintext bytes: magic(5) + epoch u64(8) + commitId(32)
+ membershipDigest(32) + epochKey(32). -}
plaintextBytes : Int
plaintextBytes =
    5 + 8 + 32 + 32 + 32


{-| A structurally valid OGW1 envelope: byte lists, never secrets. -}
type alias Envelope =
    { ephemeralPub : List Int
    , nonce : List Int
    , ciphertext : List Int
    }


{-| Welcome-context inputs. `commitId` is the 32-byte commit record id;
the epoch must fit an Elm `Int` (u64 values past 2^31-1 are refused,
like every other Elm-side epoch gate). -}
type alias ContextInput =
    { room : String
    , fromAccount : String
    , fromDevice : String
    , toAccount : String
    , toDevice : String
    , epoch : Int
    , commitId : List Int
    }


{-| Room normalization, mirroring `normalizeGroupRoom`: trimmed,
lowercased, at most 256 UTF-8 bytes, else `Nothing`. -}
normalizeRoom : String -> Maybe String
normalizeRoom room =
    let
        normalized =
            String.toLower (String.trim room)
    in
    if String.isEmpty normalized || List.length (Base64Url.utf8Bytes normalized) > 256 then
        Nothing

    else
        Just normalized


isAccountChar : Char -> Bool
isAccountChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '@' || c == '-'


isDeviceChar : Char -> Bool
isDeviceChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '-'


validAccount : String -> Bool
validAccount value =
    String.length value >= 1
        && String.length value <= 64
        && List.all isAccountChar (String.toList value)


validDevice : String -> Bool
validDevice value =
    String.length value >= 1
        && String.length value <= 32
        && List.all isDeviceChar (String.toList value)


nonZero : List Int -> Bool
nonZero bytes =
    List.any (\b -> b /= 0) bytes


u16be : Int -> List Int
u16be value =
    [ modBy 256 (value // 256), modBy 256 value ]


u64be : Int -> List Int
u64be epoch =
    [ 0, 0, 0, 0
    , modBy 256 (epoch // 16777216)
    , modBy 256 (epoch // 65536)
    , modBy 256 (epoch // 256)
    , modBy 256 epoch
    ]


writeField : List Int -> List Int -> List Int
writeField field acc =
    acc ++ u16be (List.length field) ++ field


{-| Build the exact canonical welcome context shared by HKDF salt/info
and the AES-GCM AAD: `domain || 0x00 || u16-fields… || u64be epoch ||
commitId`. Accounts lowercase before the account-grammar check;
devices keep case. Mirrors `buildGroupWelcomeContext`.
-}
buildContext : ContextInput -> Maybe (List Int)
buildContext input =
    case normalizeRoom input.room of
        Nothing ->
            Nothing

        Just room ->
            let
                fromAccount =
                    String.toLower (String.trim input.fromAccount)

                toAccount =
                    String.toLower (String.trim input.toAccount)
            in
            if input.epoch < 0 then
                Nothing

            else if not (validAccount fromAccount) || not (validAccount toAccount) then
                Nothing

            else if not (validDevice input.fromDevice) || not (validDevice input.toDevice) then
                Nothing

            else if List.length input.commitId /= commitIdBytes || not (nonZero input.commitId) then
                Nothing

            else
                let
                    fields =
                        List.map Base64Url.utf8Bytes
                            [ room, fromAccount, input.fromDevice, toAccount, input.toDevice ]

                    context =
                        List.foldl writeField
                            (Base64Url.utf8Bytes contextDomain ++ [ 0 ])
                            fields
                            ++ u64be input.epoch
                            ++ input.commitId
                in
                Just context


{-| Decode an OGW1 envelope from canonical base64url, rejecting wrong
lengths, trailing bytes, non-canonical groups, bad magic/version, and
misshapen ephemeral keys. Curve membership is enforced ports-side at
import, like the oracle's decode gate. Mirrors `decodeGroupWelcome`.
-}
decodeEnvelope : String -> Maybe Envelope
decodeEnvelope input =
    case Base64Url.decode input of
        Nothing ->
            Nothing

        Just raw ->
            if List.length raw /= envelopeBytes then
                Nothing

            else if Base64Url.encode raw /= input then
                Nothing

            else if List.take 4 raw /= Base64Url.utf8Bytes welcomeMagic then
                Nothing

            else
                case List.drop 4 raw of
                    version :: rest ->
                        if version /= welcomeVersion then
                            Nothing

                        else
                            let
                                ephemeralPub =
                                    List.take ephemeralBytes rest

                                nonce =
                                    rest |> List.drop ephemeralBytes |> List.take nonceBytes

                                ciphertext =
                                    List.drop (ephemeralBytes + nonceBytes) rest
                            in
                            if List.length ephemeralPub /= ephemeralBytes || List.head ephemeralPub /= Just 4 then
                                Nothing

                            else if List.length nonce /= nonceBytes then
                                Nothing

                            else if List.length ciphertext /= ciphertextBytes then
                                Nothing

                            else
                                Just { ephemeralPub = ephemeralPub, nonce = nonce, ciphertext = ciphertext }

                    _ ->
                        Nothing
