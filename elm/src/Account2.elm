module Account2 exposing
    ( CopyStatus(..)
    , ExpiryChoice
    , Portable
    , PortableInput
    , clipboardTags
    , expiryChoices
    , expiryFor
    , expiryLabel
    , extractThemeCode
    , forbiddenPortableKeys
    , lastSeenLabel
    , maxBookmarks
    , maxPortableChars
    , parsePortable
    , parsePortableBookmarks
    , portableFilename
    , portableImportStatus
    , portableKind
    , portableVersion
    , revokeOthersPrompt
    , serializePortable
    , shareTheme
    , shareUrl
    , sortContacts
    , statusExpired
    )

{-| v3/account2 — pure helpers behind the account completeness slice:

  - theme share/import code extraction (`ThemeImportDialog.extractCode`);
  - the portable residence document (`lib/identity/portableIdentity.ts`):
    build, serialize and fail-closed parse;
  - custom-status expiry presets and copy;
  - friends / watch list ordering and last-seen copy;
  - the bulk "Revoke other devices" confirm copy
    (`SessionsDevicesSection.onRevokeOthers`).

No `App` import — `App` imports this module.

-}

import Dict
import Json.Decode as Decode
import Json.Encode as Encode
import Studio
import ThemeTokens



-- CLIPBOARD


{-| A copy button's receipt state. -}
type CopyStatus
    = CopyIdle
    | CopyDone
    | CopyFailed


{-| Clipboard receipt tags this slice owns. -}
clipboardTags : List String
clipboardTags =
    [ "theme-share", "portable-copy" ]



-- THEME SHARE / IMPORT


{-| Pull the share code out of a pasted code or link (mirroring
`extractCode`: trim; when the text carries `theme=`, read the URL's
`theme` search param; otherwise — or when the link has none — the
trimmed text is the code).
-}
extractThemeCode : String -> String
extractThemeCode input =
    let
        trimmed =
            String.trim input
    in
    if String.isEmpty trimmed then
        ""

    else if not (String.contains "theme=" trimmed) then
        trimmed

    else
        Maybe.withDefault trimmed (themeSearchParam trimmed)


themeSearchParam : String -> Maybe String
themeSearchParam input =
    let
        withoutFragment =
            String.split "#" input |> List.head |> Maybe.withDefault input
    in
    case String.indexes "?" withoutFragment of
        first :: _ ->
            String.dropLeft (first + 1) withoutFragment
                |> String.split "&"
                |> List.filterMap
                    (\pair ->
                        if String.startsWith "theme=" pair then
                            Just (percentDecodeForm (String.dropLeft 6 pair))

                        else
                            Nothing
                    )
                |> List.head

        [] ->
            Nothing


{-| `URLSearchParams` value decoding: `+` is a space, ASCII `%XX`
decodes; a malformed escape keeps the raw value (the share decoder
then fails closed on it).
-}
percentDecodeForm : String -> String
percentDecodeForm raw =
    let
        spaced =
            String.replace "+" " " raw
    in
    Maybe.withDefault spaced (percentDecode spaced)


percentDecode : String -> Maybe String
percentDecode s =
    let
        go chars acc =
            case chars of
                [] ->
                    Just (String.fromList (List.reverse acc))

                '%' :: a :: b :: rest ->
                    case ( hexVal a, hexVal b ) of
                        ( Just hi, Just lo ) ->
                            let
                                code =
                                    hi * 16 + lo
                            in
                            if code < 0x80 then
                                go rest (Char.fromCode code :: acc)

                            else
                                Nothing

                        _ ->
                            Nothing

                '%' :: _ ->
                    Nothing

                c :: rest ->
                    go rest (c :: acc)
    in
    go (String.toList s) []


hexVal : Char -> Maybe Int
hexVal c =
    let
        code =
            Char.toCode c
    in
    if code >= 0x30 && code <= 0x39 then
        Just (code - 0x30)

    else if code >= 0x61 && code <= 0x66 then
        Just (code - 0x61 + 10)

    else if code >= 0x41 && code <= 0x46 then
        Just (code - 0x41 + 10)

    else
        Nothing



{-| The saved custom theme a share link can carry (mirroring
`AppearancePanel.shareTheme`: only a saved custom theme is shareable).
-}
shareTheme : String -> List Studio.CustomTheme -> Maybe Studio.CustomTheme
shareTheme themeId customs =
    if Studio.isCustomThemeId themeId then
        List.filter (\custom -> custom.id == themeId) customs |> List.head

    else
        Nothing


{-| `themeShareUrl(theme, location.origin)`; `Nothing` when nothing is
shareable or the theme fails to encode.
-}
shareUrl : String -> List Studio.CustomTheme -> String -> Maybe String
shareUrl themeId customs origin =
    shareTheme themeId customs
        |> Maybe.andThen
            (\theme ->
                if String.isEmpty (Studio.encodeThemeShare ThemeTokens.themeIds theme) then
                    Nothing

                else
                    Just (Studio.themeShareUrl ThemeTokens.themeIds theme origin)
            )



-- PORTABLE RESIDENCE


portableKind : String
portableKind =
    "onyx.portable-identity"


portableVersion : Int
portableVersion =
    1


{-| `MAX_PORTABLE_IDENTITY_CHARS`. -}
maxPortableChars : Int
maxPortableChars =
    256 * 1024


{-| `MAX_BOOKMARKS`. -}
maxBookmarks : Int
maxBookmarks =
    48


{-| Keys whose presence at the root refuses the whole document
(mirroring the oracle's `forbidden` list).
-}
forbiddenPortableKeys : List String
forbiddenPortableKeys =
    [ "privateKey", "recoveryCodes", "sessionToken", "meshToken", "password" ]


type alias PortableInput =
    { preferences : Encode.Value
    , bookmarks : List String
    , networkHint : Maybe String
    , exportedAt : String
    }


{-| A parsed residence document. Folders and quiet hours are carried
for the import report; this client has no folder or quiet-hours state
to apply them to.
-}
type alias Portable =
    { exportedAt : String
    , networkHint : Maybe String
    , bookmarks : List String
    , folderCount : Int
    , quietHours : { startHour : Int, endHour : Int }
    }


{-| Serialize a residence document (mirroring
`buildPortableIdentity` + `serializePortableIdentity`: 2-space JSON
plus a trailing newline). This client keeps no room folders or quiet
hours, so those fields carry the oracle's empty/default values.
-}
serializePortable : PortableInput -> String
serializePortable input =
    Encode.encode 2
        (Encode.object
            ([ ( "kind", Encode.string portableKind )
             , ( "version", Encode.int portableVersion )
             , ( "exportedAt", Encode.string input.exportedAt )
             ]
                ++ (case cleanHint input.networkHint of
                        Just h ->
                            [ ( "networkHint", Encode.string h ) ]

                        Nothing ->
                            []
                   )
                ++ [ ( "preferences", input.preferences )
                   , ( "bookmarks", Encode.list Encode.string (sanitizeBookmarks input.bookmarks) )
                   , ( "categories", Encode.object [ ( "categories", Encode.list identity [] ) ] )
                   , ( "quietHours", Encode.object [ ( "startHour", Encode.int 22 ), ( "endHour", Encode.int 8 ) ] )
                   ]
            )
        )
        ++ "\n"


cleanHint : Maybe String -> Maybe String
cleanHint hint =
    hint
        |> Maybe.map (String.trim >> String.left 64)
        |> Maybe.andThen
            (\h ->
                if String.isEmpty h then
                    Nothing

                else
                    Just h
            )


{-| Parse a residence document, fail-closed (mirroring
`parsePortableIdentity`): size cap, JSON object root, exact kind and
version, a parseable `exportedAt` (checked by the caller's
`validDate`), and no secret-named key at the root.
-}
parsePortable : (String -> Bool) -> String -> Maybe Portable
parsePortable validDate raw =
    if String.isEmpty raw || String.length raw > maxPortableChars then
        Nothing

    else
        case Decode.decodeString (Decode.keyValuePairs Decode.value) raw of
            Err _ ->
                Nothing

            Ok pairs ->
                let
                    obj =
                        Dict.fromList pairs

                    field name decoder =
                        Dict.get name obj |> Maybe.andThen (Decode.decodeValue decoder >> Result.toMaybe)
                in
                if field "kind" Decode.string /= Just portableKind then
                    Nothing

                else if field "version" Decode.int /= Just portableVersion then
                    Nothing

                else if List.any (\key -> Dict.member key obj) forbiddenPortableKeys then
                    Nothing

                else
                    case field "exportedAt" Decode.string of
                        Nothing ->
                            Nothing

                        Just exportedAt ->
                            if not (validDate exportedAt) then
                                Nothing

                            else
                                Just
                                    { exportedAt = exportedAt
                                    , networkHint = cleanHint (field "networkHint" Decode.string)
                                    , bookmarks =
                                        Dict.get "bookmarks" obj
                                            |> Maybe.map parsePortableBookmarks
                                            |> Maybe.withDefault []
                                    , folderCount =
                                        field "categories" (Decode.field "categories" (Decode.list (Decode.maybe (Decode.field "name" Decode.string))))
                                            |> Maybe.map (List.filter (Maybe.map (String.trim >> String.isEmpty >> not) >> Maybe.withDefault False) >> List.length)
                                            |> Maybe.withDefault 0
                                    , quietHours =
                                        { startHour = clampHour (field "quietHours" (Decode.field "startHour" Decode.float)) 22
                                        , endHour = clampHour (field "quietHours" (Decode.field "endHour" Decode.float)) 8
                                        }
                                    }


{-| `parseBookmarks`: strings only, first 48 entries, sanitized
(`#`/`&`/`+` prefix, ≤ 64 chars, no controls), case-insensitive
first-wins dedupe.
-}
parsePortableBookmarks : Decode.Value -> List String
parsePortableBookmarks value =
    case Decode.decodeValue (Decode.list Decode.value) value of
        Err _ ->
            []

        Ok entries ->
            entries
                |> List.take maxBookmarks
                |> List.filterMap (Decode.decodeValue Decode.string >> Result.toMaybe)
                |> sanitizeBookmarks


sanitizeBookmarks : List String -> List String
sanitizeBookmarks entries =
    List.foldl
        (\entry ( seen, acc ) ->
            case sanitizeChannel entry of
                Nothing ->
                    ( seen, acc )

                Just safe ->
                    let
                        key =
                            String.toLower safe
                    in
                    if List.member key seen then
                        ( seen, acc )

                    else
                        ( key :: seen, safe :: acc )
        )
        ( [], [] )
        (List.take maxBookmarks entries)
        |> Tuple.second
        |> List.reverse


sanitizeChannel : String -> Maybe String
sanitizeChannel channel =
    let
        trimmed =
            String.trim channel
    in
    if String.isEmpty trimmed || String.length trimmed > 64 then
        Nothing

    else if String.any (\c -> Char.toCode c < 0x20 || Char.toCode c == 0x7F) trimmed then
        Nothing

    else if String.startsWith "#" trimmed || String.startsWith "&" trimmed || String.startsWith "+" trimmed then
        Just trimmed

    else
        Nothing


clampHour : Maybe Float -> Int -> Int
clampHour value fallback =
    case value of
        Just v ->
            if isNaN v || isInfinite v then
                fallback

            else
                let
                    hour =
                        floor v
                in
                if hour < 0 || hour > 23 then
                    fallback

                else
                    hour

        Nothing ->
            fallback


{-| `onyx-residence-YYYY-MM-DD.json` from an ISO timestamp. -}
portableFilename : String -> String
portableFilename iso =
    "onyx-residence-" ++ String.left 10 iso ++ ".json"


{-| The import report. The oracle reports favorites and folders; this
client applies favorites only, so skipped folders are said out loud.
-}
portableImportStatus : Portable -> Int -> String
portableImportStatus doc applied =
    "Imported "
        ++ String.fromInt applied
        ++ " favorite(s)."
        ++ (if doc.folderCount > 0 then
                " Room folders aren't available in this client yet, so "
                    ++ String.fromInt doc.folderCount
                    ++ " folder(s) were skipped."

            else
                ""
           )



-- CUSTOM STATUS


type alias ExpiryChoice =
    { id : String
    , label : String
    , minutes : Maybe Int
    }


expiryChoices : List ExpiryChoice
expiryChoices =
    [ { id = "never", label = "Don't clear", minutes = Nothing }
    , { id = "30m", label = "30 minutes", minutes = Just 30 }
    , { id = "1h", label = "1 hour", minutes = Just 60 }
    , { id = "4h", label = "4 hours", minutes = Just 240 }
    , { id = "24h", label = "24 hours", minutes = Just 1440 }
    ]


{-| The expiry epoch a choice lands on; unknown ids never clear. -}
expiryFor : String -> Float -> Maybe Float
expiryFor choice now =
    expiryChoices
        |> List.filter (\c -> c.id == choice)
        |> List.head
        |> Maybe.andThen .minutes
        |> Maybe.map (\m -> now + toFloat m * 60000)


statusExpired : Maybe Float -> Float -> Bool
statusExpired expiry now =
    case expiry of
        Just at ->
            now >= at

        Nothing ->
            False


{-| Relative copy for a status expiry. -}
expiryLabel : Maybe Float -> Float -> String
expiryLabel expiry now =
    case expiry of
        Nothing ->
            ""

        Just at ->
            if now >= at then
                "Expired"

            else
                let
                    minutes =
                        ceiling ((at - now) / 60000)
                in
                if minutes < 60 then
                    "Clears in " ++ String.fromInt minutes ++ " min"

                else
                    "Clears in " ++ String.fromInt (ceiling (toFloat minutes / 60)) ++ " h"



-- PEOPLE


{-| Online first, then case-insensitive nick order. -}
sortContacts : List { a | nick : String, online : Bool } -> List { a | nick : String, online : Bool }
sortContacts =
    List.sortBy
        (\c ->
            ( if c.online then
                0

              else
                1
            , String.toLower c.nick
            )
        )


lastSeenLabel : Maybe Int -> Float -> String
lastSeenLabel lastSeen now =
    case lastSeen of
        Nothing ->
            "Not seen yet"

        Just at ->
            let
                minutes =
                    max 0 (round now - at) // 60000
            in
            if minutes < 1 then
                "Last seen just now"

            else if minutes < 60 then
                "Last seen " ++ String.fromInt minutes ++ "m ago"

            else if minutes < 48 * 60 then
                "Last seen " ++ String.fromInt (minutes // 60) ++ "h ago"

            else
                "Last seen " ++ String.fromInt (minutes // 1440) ++ "d ago"



-- SESSIONS


{-| `window.confirm` copy of `onRevokeOthers`, shown inline. -}
revokeOthersPrompt : Int -> String
revokeOthersPrompt count =
    "Revoke "
        ++ String.fromInt count
        ++ " other session"
        ++ (if count == 1 then
                ""

            else
                "s"
           )
        ++ "? Those devices will need to sign in again."
