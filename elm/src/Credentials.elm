module Credentials exposing
    ( RememberedIdentityAccess(..)
    , credentialKey
    , enforceCredentialKeep
    , identityAccess
    , identityId
    , imul32
    , maxCredentialNickLength
    , maxCredentialPasswordLength
    , maxCredentialResumeTokenLength
    , maxCredentialServerLength
    , maxHandoffField
    , maxHandoffs
    , normalizeServer
    , sanitizeCredentialNick
    , sanitizeCredentialPassword
    , sanitizeCredentialServer
    , sanitizeResumeToken
    , serverDisplayLabel
    , sortRememberedKeys
    )

{-| Remembered-identity pure logic, mirroring `src/lib/credentials.ts`.

Elm owns validation, key derivation, picker ids, display labels, access
classification, catalogue order, and the 12-entry keep-set. Everything
that touches secrets or `localStorage` (`readStore`/`writeStore`,
`saveCredentials`, token stores/clears, handoff import/export, and all
`Date.parse` timestamp/expiry reads) stays behind `ports.js`, which
already owns the `onyx:credentials` slot.

Known divergences (documented, exotic-only): `identityId` iterates
UTF-16 code units in JS but Elm code points, so astral-plane keys hash
differently; `normalizeServer`/`serverDisplayLabel` do not punycode
non-ASCII hosts; catalogue order uses codepoint `compare` where the
oracle uses `localeCompare`, so punctuation-adjacent keys can order
differently (verified: `:8443` sorts before `//a` under `localeCompare`
but after it under `compare`). Display order only — ids are unaffected.
-}

import Bitwise
import Regex


maxCredentialNickLength : Int
maxCredentialNickLength =
    64


maxCredentialServerLength : Int
maxCredentialServerLength =
    2048


maxCredentialPasswordLength : Int
maxCredentialPasswordLength =
    65536


maxCredentialResumeTokenLength : Int
maxCredentialResumeTokenLength =
    4096


maxHandoffs : Int
maxHandoffs =
    12


maxHandoffField : Int
maxHandoffField =
    256


type RememberedIdentityAccess
    = ResumeAccess
    | SignInAccess
    | IdentityOnlyAccess


nickPattern : Regex.Regex
nickPattern =
    Regex.fromString "^[A-Za-z[\\]\\\\`_^{|}][A-Za-z0-9[\\]\\\\`_^{|}-]*$"
        |> Maybe.withDefault Regex.never


{-| JS `\s` shape (duplicated from the room-name helper so this domain
module never imports the app fold).
-}
isCredentialSpace : Char -> Bool
isCredentialSpace c =
    let
        code =
            Char.toCode c
    in
    code == 0x20
        || (code >= 0x09 && code <= 0x0D)
        || code == 0x00A0
        || code == 0x1680
        || (code >= 0x2000 && code <= 0x200A)
        || code == 0x2028
        || code == 0x2029
        || code == 0x202F
        || code == 0x205F
        || code == 0x3000
        || code == 0xFEFF


isServerControl : Char -> Bool
isServerControl c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


isPasswordControl : Char -> Bool
isPasswordControl c =
    let
        code =
            Char.toCode c
    in
    code < 0x20 || code == 0x7F


sanitizeCredentialNick : String -> Maybe String
sanitizeCredentialNick value =
    if String.length value > maxCredentialNickLength * 2 then
        Nothing

    else
        let
            nick =
                String.trim value
        in
        if String.isEmpty nick then
            Nothing

        else if String.length nick > maxCredentialNickLength then
            Nothing

        else if Regex.contains nickPattern nick then
            Just nick

        else
            Nothing


sanitizeCredentialServer : String -> Maybe String
sanitizeCredentialServer value =
    if String.length value > maxCredentialServerLength * 2 then
        Nothing

    else
        let
            server =
                String.trim value
        in
        if String.isEmpty server then
            Nothing

        else if String.length server > maxCredentialServerLength then
            Nothing

        else if List.any isServerControl (String.toList server) then
            Nothing

        else
            Just server


sanitizeCredentialPassword : String -> Maybe String
sanitizeCredentialPassword value =
    if String.length value > maxCredentialPasswordLength then
        Nothing

    else if List.any isPasswordControl (String.toList value) then
        Nothing

    else
        Just value


sanitizeResumeToken : String -> Maybe String
sanitizeResumeToken value =
    if String.isEmpty value then
        Nothing

    else if String.length value > maxCredentialResumeTokenLength then
        Nothing

    else if List.any (\c -> isCredentialSpace c || isPasswordControl c) (String.toList value) then
        Nothing

    else
        Just value


{-| Split `scheme://rest`. The scheme opens with a letter, then takes
word/`+`-`-`/`.` characters.
-}
splitScheme : String -> Maybe ( String, String )
splitScheme value =
    let
        chars =
            String.toList value

        schemeChars =
            takeWhile (\c -> Char.isAlphaNum c || c == '+' || c == '-' || c == '.') chars
    in
    case chars of
        lead :: _ ->
            if not (Char.isAlpha lead) || List.isEmpty schemeChars then
                Nothing

            else
                let
                    scheme =
                        String.fromList schemeChars

                    rest =
                        String.dropLeft (String.length scheme) value
                in
                if String.startsWith "://" rest then
                    Just ( scheme, String.dropLeft 3 rest )

                else
                    Nothing

        [] ->
            Nothing


takeWhile : (a -> Bool) -> List a -> List a
takeWhile pred list =
    case list of
        x :: xs ->
            if pred x then
                x :: takeWhile pred xs

            else
                []

        [] ->
            []


{-| Split the authority (host/userinfo/port) from the path/query/hash
tail: the authority runs to the first `/`, `?`, or `#`.
-}
splitAuthority : String -> ( String, String )
splitAuthority rest =
    let
        go chars acc =
            case chars of
                [] ->
                    ( String.fromList (List.reverse acc), "" )

                c :: tail ->
                    if c == '/' || c == '?' || c == '#' then
                        ( String.fromList (List.reverse acc), String.fromList chars )

                    else
                        go tail (c :: acc)
    in
    go (String.toList rest) []


lastIndexOf : Char -> String -> Maybe Int
lastIndexOf needle value =
    String.toList value
        |> List.indexedMap Tuple.pair
        |> List.filter (\( _, c ) -> c == needle)
        |> List.map Tuple.first
        |> List.reverse
        |> List.head


defaultPortFor : String -> Maybe String
defaultPortFor scheme =
    case scheme of
        "http" ->
            Just "80"

        "https" ->
            Just "443"

        "ws" ->
            Just "80"

        "wss" ->
            Just "443"

        _ ->
            Nothing


stripDefaultPort : String -> String -> String
stripDefaultPort scheme hostport =
    case defaultPortFor scheme of
        Just def ->
            if String.startsWith "[" hostport then
                -- Bracketed IPv6 literal: WHATWG still drops the
                -- default port (`wss://[::1]:443/` → `wss://[::1]`).
                if String.endsWith ("]:" ++ def) hostport then
                    String.dropRight (String.length def + 1) hostport

                else
                    hostport

            else
                case lastIndexOf ':' hostport of
                    Just idx ->
                        if String.dropLeft (idx + 1) hostport == def then
                            String.left idx hostport

                        else
                            hostport

                    Nothing ->
                        hostport

        Nothing ->
            hostport


normalizeAuthority : String -> String -> String
normalizeAuthority scheme authority =
    case lastIndexOf '@' authority of
        Just at ->
            -- Userinfo echoes verbatim; only the host lowercases.
            String.left (at + 1) authority
                ++ String.toLower (stripDefaultPort scheme (String.dropLeft (at + 1) authority))

        Nothing ->
            String.toLower (stripDefaultPort scheme authority)


{-| Mirror the `normalizeServer` URL branch: lowercase scheme + host,
drop default ports and one trailing slash. The query/hash tail echoes
verbatim (the oracle's `toString()` keeps it too). Non-URL endpoints
fall back to lowercase + slash-strip.
-}
normalizeServer : String -> String
normalizeServer server =
    let
        trimmed =
            String.trim server
    in
    case splitScheme trimmed of
        Just ( scheme, rest ) ->
            let
                ( authority, tail ) =
                    splitAuthority rest
            in
            stripTrailingSlash
                (String.toLower scheme ++ "://" ++ normalizeAuthority (String.toLower scheme) authority ++ tail)

        Nothing ->
            stripTrailingSlash (String.toLower trimmed)


stripTrailingSlash : String -> String
stripTrailingSlash value =
    if String.endsWith "/" value then
        String.dropRight 1 value

    else
        value


credentialKey : String -> String -> String
credentialKey server nick =
    normalizeServer server ++ "|" ++ String.toLower (String.trim nick)


{-| Unsigned 32-bit value rendered base36 (JS `>>> 0 … .toString(36)`).
Float carries the magnitude exactly below 2^53.
-}
base36Unsigned : Int -> String
base36Unsigned n =
    let
        unsigned =
            toFloat n + (if n < 0 then 4294967296 else 0)
    in
    base36Loop unsigned ""


base36Loop : Float -> String -> String
base36Loop v acc =
    let
        digit =
            base36Digit (floor (v - 36 * toFloat (floor (v / 36))))

        next =
            floor (v / 36)
    in
    if v < 36 then
        digit ++ acc

    else
        base36Loop (toFloat next) (digit ++ acc)


base36Digit : Int -> String
base36Digit d =
    if d < 10 then
        String.fromInt d

    else
        String.fromChar (Char.fromCode (Char.toCode 'a' + d - 10))


{-| 32-bit multiply with wraparound (`Math.imul` semantics — Elm's
native `*` runs on floats and never wraps).
-}
imul32 : Int -> Int -> Int
imul32 a b =
    let
        ah =
            Bitwise.and 0xFFFF (Bitwise.shiftRightBy 16 a)

        al =
            Bitwise.and 0xFFFF a

        bh =
            Bitwise.and 0xFFFF (Bitwise.shiftRightBy 16 b)

        bl =
            Bitwise.and 0xFFFF b

        p0 =
            al * bl

        p1 =
            Bitwise.shiftRightBy 16 p0 + Bitwise.and 0xFFFF (ah * bl + al * bh)
    in
    Bitwise.or (Bitwise.shiftLeftBy 16 (Bitwise.and 0xFFFF p1)) (Bitwise.and 0xFFFF p0)


{-| Opaque picker id: two independent 32-bit hashes, never the key
itself (which can contain a URL path).
-}
identityId : String -> String
identityId key =
    let
        step multiplier state code =
            imul32 (Bitwise.xor state code) multiplier

        ( first, second ) =
            List.foldl
                (\c ( f, s ) ->
                    ( step 0x01000193 f (Char.toCode c)
                    , step 0x85EBCA6B s (Char.toCode c)
                    )
                )
                ( 0x811C9DC5, 0x9E3779B9 )
                (String.toList key)
    in
    "saved-" ++ base36Unsigned first ++ "-" ++ base36Unsigned second


{-| Token-first: passkey identities carry no password, and a live
session token is itself the bearer reclaim path. Token currency
(expiry vs now) is decided ports-side, which already purges.
-}
identityAccess : Bool -> Bool -> RememberedIdentityAccess
identityAccess hasToken hasPassword =
    if hasToken then
        ResumeAccess

    else if hasPassword then
        SignInAccess

    else
        IdentityOnlyAccess


{-| Recognizable server label that never echoes URL credentials, query
secrets, or control bytes; capped at 256 chars.
-}
serverDisplayLabel : String -> String
serverDisplayLabel server =
    let
        trimmed =
            String.trim server
    in
    case splitScheme trimmed of
        Just ( scheme, rest ) ->
            let
                ( authority, tail ) =
                    splitAuthority rest

                hostport =
                    case lastIndexOf '@' authority of
                        Just at ->
                            String.dropLeft (at + 1) authority

                        Nothing ->
                            authority

                path =
                    -- Pathname only: cut any query/hash tail.
                    let
                        noQuery =
                            cutQueryHash tail
                    in
                    if noQuery == "" || noQuery == "/" then
                        ""

                    else
                        noQuery
            in
            String.left maxHandoffField
                (String.toLower scheme
                    ++ "://"
                    ++ String.toLower (stripDefaultPort (String.toLower scheme) hostport)
                    ++ path
                )

        Nothing ->
            String.left maxHandoffField (stripLabelUserinfo (cutLabelTail (stripLabelControls trimmed)))


stripLabelControls : String -> String
stripLabelControls value =
    String.filter (\c -> not (isPasswordControl c)) value


cutLabelTail : String -> String
cutLabelTail value =
    -- The oracle cuts a schemeless label at ?/# only: bare paths stay.
    cutQueryHash value


cutQueryHash : String -> String
cutQueryHash value =
    value
        |> String.split "?"
        |> List.head
        |> Maybe.withDefault value
        |> String.split "#"
        |> List.head
        |> Maybe.withDefault value


stripLabelUserinfo : String -> String
stripLabelUserinfo value =
    -- `^([^/]*//)?[^/@]+@` → `$1`: drop a userinfo run, keeping any
    -- scheme prefix.
    let
        ( prefix, rest ) =
            if String.contains "//" value then
                case String.split "//" value of
                    head :: tail ->
                        ( head ++ "//", String.join "//" tail )

                    [] ->
                        ( "", value )

            else
                ( "", value )
    in
    case lastIndexOf '@' rest of
        Just at ->
            let
                candidate =
                    String.left at rest
            in
            if String.contains "/" candidate then
                value

            else
                prefix ++ String.dropLeft (at + 1) rest

        Nothing ->
            value


{-| Catalogue order: the active entry first, then key order (the oracle
uses `localeCompare`; identical on ASCII keys).
-}
sortRememberedKeys : Maybe String -> List String -> List String
sortRememberedKeys activeKey keys =
    List.sortWith
        (\left right ->
            if Just left == activeKey then
                LT

            else if Just right == activeKey then
                GT

            else
                compare left right
        )
        keys


{-| The 12-entry keep-set: the active entry plus the 11 newest by
`savedAt` (ports-side epoch millis), ties falling back to key order.
-}
enforceCredentialKeep : Maybe String -> List ( String, Int ) -> List String
enforceCredentialKeep activeKey dated =
    dated
        |> List.sortWith
            (\( leftKey, leftAt ) ( rightKey, rightAt ) ->
                if Just leftKey == activeKey then
                    LT

                else if Just rightKey == activeKey then
                    GT

                else
                    case compare rightAt leftAt of
                        EQ ->
                            compare leftKey rightKey

                        order ->
                            order
            )
        |> List.map Tuple.first
        |> List.take maxHandoffs
