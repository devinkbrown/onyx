module Invite exposing
    ( InviteCard
    , InviteLink
    , InviteLinkOpts
    , InviteLinkSpec
    , OgMeta
    , buildInviteCard
    , buildInviteLink
    , buildMomentLink
    , formEncode
    , guestNameError
    , inviteDescription
    , inviteFaceMax
    , inviteHeadline
    , inviteOgMeta
    , inviteTitle
    , inviteWelcome
    , mergeInviteFaces
    , nicknameError
    , parseAtParam
    , parseGuestName
    , parseInviteFaces
    , parseJoinParam
    , parseNickname
    , parseQueryParams
    , parseReaderParam
    , parseTopicParam
    , utf8ByteLength
    )

{-| Pure invite-link model, mirroring `lib/invite/inviteCard.ts`,
`lib/invite/inviteLink.ts`, and the `lib/deeplink` + `lib/identity/nickname`
parsers they build on. Every param is untrusted input and validates at
this boundary: bad nicks, control characters, commas, and over-long
values are dropped, never reflected.

`at` moments are `Float` epoch-ms (Elm `Int` is 32-bit; ms timestamps
do not fit — the same reason `SavedSearches` uses `Float`). ISO output
reuses `SavedSearches.isoFromMillis` (`toISOString` shape); ISO input
reuses the strict `SavedSearches.parseIsoMillis` subset.

Divergences (documented, all on hostile input only):
  - `parseJoinParam` rejects the exact JS `\s` set (including Zs
    spaces, U+2028/2029, U+FEFF); a bare `String.trim` would miss
    the exotic ones.
  - Length bounds count Unicode code points, not UTF-16 units.
  - `parseAtParam` accepts only the strict ISO subset, never the
    looser `Date.parse` forms.
-}

import Dict exposing (Dict)
import SavedSearches
import Url


{-| Max faces carried on a card (`INVITE_FACE_MAX`). -}
inviteFaceMax : Int
inviteFaceMax =
    3


{-| Earliest instant an `?at=` link may point to (2020-01-01Z). -}
atParamMinMs : Float
atParamMinMs =
    1577836800000


{-| Clock-skew allowance for future `?at=` values (24h). -}
atParamFutureSlackMs : Float
atParamFutureSlackMs =
    86400000


{-| First-nick code points: ASCII letters plus the IRC specials. -}
isNickStart : Char -> Bool
isNickStart c =
    (c >= 'A' && c <= 'Z')
        || (c >= 'a' && c <= 'z')
        || c == '['
        || c == ']'
        || c == '\\'
        || c == '`'
        || c == '_'
        || c == '^'
        || c == '{'
        || c == '|'
        || c == '}'


{-| Nick body adds digits and `-`. Mirrors `NICK_RE`. -}
isNickBody : Char -> Bool
isNickBody c =
    isNickStart c || (c >= '0' && c <= '9') || c == '-'


{-| IRC-compatible nick: letter/special first, then letters, digits,
`-`, or specials, capped at 64. Mirrors `parseNickname`
(`Connect.validateNick` downstream stays server-authoritative). -}
parseNickname : Maybe String -> Maybe String
parseNickname raw =
    case raw of
        Nothing ->
            Nothing

        Just value ->
            let
                trimmed =
                    String.trim value
            in
            case String.toList trimmed of
                [] ->
                    Nothing

                first :: rest ->
                    if String.length trimmed > 64 || not (isNickStart first) || not (List.all isNickBody rest) then
                        Nothing

                    else
                        Just trimmed


{-| Name error for the invite form, mirroring `nicknameError`.
`allowEmpty` keeps the join-later flow (empty is fine). -}
nicknameError : String -> Bool -> Maybe String
nicknameError raw allowEmpty =
    let
        value =
            String.trim raw
    in
    if String.isEmpty value then
        if allowEmpty then
            Nothing

        else
            Just "Name is required."

    else if String.length value > 64 then
        Just "Name must be 64 characters or fewer."

    else
        case String.toList value of
            [] ->
                Nothing

            first :: rest ->
                if isNickStart first && List.all isNickBody rest then
                    Nothing

                else
                    Just "Name must start with a letter or allowed special character and contain only letters, numbers, or -[]\\\\`_^{|}."


{-| Suggested guest name from `?as=` — validated at this boundary. -}
parseGuestName : Maybe String -> Maybe String
parseGuestName =
    parseNickname


{-| Empty is allowed (the recipient can still join and pick a name). -}
guestNameError : String -> Maybe String
guestNameError raw =
    nicknameError raw True


{-| JS `\s` without the unicode flag: ASCII whitespace plus the
exact Zs/line/zero-width set `URLSearchParams` trims around values. -}
isFormSpace : Char -> Bool
isFormSpace c =
    c == ' '
        || c == '\t'
        || c == '\n'
        || c == '\u{000B}'
        || c == '\u{000C}'
        || c == '\r'
        || c == '\u{00A0}'
        || c == '\u{1680}'
        || (c >= '\u{2000}' && c <= '\u{200A}')
        || c == '\u{2028}'
        || c == '\u{2029}'
        || c == '\u{202F}'
        || c == '\u{3000}'
        || c == '\u{FEFF}'


{-| Form-decode one query part the way `URLSearchParams` parses a query
string: `+` is a space, then percent-decode. Malformed sequences stay
raw (the URL parser is lenient here — strictness lives in stage two). -}
formDecode : String -> String
formDecode raw =
    Url.percentDecode (String.replace "+" " " raw) |> Maybe.withDefault raw


{-| Strict stage-two decode, mirroring `decodeURIComponent` (no `+`
handling; malformed input fails). `Nothing` is fail-closed. -}
strictDecode : String -> Maybe String
strictDecode =
    Url.percentDecode


{-| Split a raw query string into first-wins pairs, mirroring
`URLSearchParams.get` (repeated params take the first; values arrive
decoded, exactly as `.get()` returns them). -}
parseQueryParams : String -> Dict String String
parseQueryParams query =
    List.foldl
        (\pair acc ->
            case String.split "=" pair of
                name :: rest ->
                    let
                        key =
                            formDecode name
                    in
                    if Dict.member key acc then
                        acc

                    else
                        Dict.insert key (formDecode (String.join "=" rest)) acc

                [] ->
                    acc
        )
        Dict.empty
        (String.split "&" query)


{-| `?join=` room: `#`/`&` prefix, 1–63 body chars, no whitespace,
controls, DEL, or commas. Mirrors `JOIN_PARAM_RE`. -}
parseJoinParam : Maybe String -> Maybe String
parseJoinParam raw =
    case Maybe.andThen strictDecode raw of
        Nothing ->
            Nothing

        Just decoded ->
            let
                trimmed =
                    String.trim decoded
            in
            case String.toList trimmed of
                '#' :: body ->
                    joinBody body trimmed

                '&' :: body ->
                    joinBody body trimmed

                _ ->
                    Nothing


joinBody : List Char -> String -> Maybe String
joinBody body whole =
    if List.isEmpty body || List.length body > 63 then
        Nothing

    else if List.any (\c -> isFormSpace c || c == ',' || c == '\u{007F}' || c <= '\u{001F}') body then
        Nothing

    else
        Just whole


{-| UTF-8 byte length of a string. -}
utf8ByteLength : String -> Int
utf8ByteLength s =
    List.foldl
        (\c acc ->
            let
                code =
                    Char.toCode c
            in
            acc
                + (if code < 0x80 then
                    1

                   else if code < 0x800 then
                    2

                   else if code < 0x10000 then
                    3

                   else
                    4
                  )
        )
        0
        (String.toList s)


{-| `?topic=` anchor: trimmed, no C0 controls/DEL/commas, at most 50
UTF-8 bytes. Mirrors `parseTopicParam`. -}
parseTopicParam : Maybe String -> Maybe String
parseTopicParam raw =
    case Maybe.andThen strictDecode raw of
        Nothing ->
            Nothing

        Just decoded ->
            let
                trimmed =
                    String.trim decoded
            in
            if String.isEmpty trimmed then
                Nothing

            else if List.any (\c -> c == ',' || c == '\u{007F}' || c <= '\u{001F}') (String.toList trimmed) then
                Nothing

            else if utf8ByteLength trimmed > 50 then
                Nothing

            else
                Just trimmed


{-| `?reader=` flag: `1`, `true`, or `reader` (case-insensitive). -}
parseReaderParam : Maybe String -> Bool
parseReaderParam raw =
    case raw of
        Nothing ->
            False

        Just value ->
            case String.toLower (String.trim value) of
                "1" ->
                    True

                "true" ->
                    True

                "reader" ->
                    True

                _ ->
                    False


{-| All-digit ASCII (epoch seconds or millis shapes). -}
isDigits : String -> Bool
isDigits s =
    not (String.isEmpty s) && List.all (\c -> c >= '0' && c <= '9') (String.toList s)


{-| `?at=` moment: epoch seconds (1–10 digits), epoch millis
(11–14), or the strict ISO subset — bounded to
[2020-01-01Z, nowMs + 24h]. A bad link never breaks the flow. -}
parseAtParam : Float -> Maybe String -> Maybe Float
parseAtParam nowMs raw =
    case Maybe.andThen strictDecode raw of
        Nothing ->
            Nothing

        Just decoded ->
            let
                trimmed =
                    String.trim decoded

                candidate =
                    if isDigits trimmed && String.length trimmed <= 10 then
                        String.toFloat trimmed |> Maybe.map (\s -> s * 1000)

                    else if isDigits trimmed && String.length trimmed <= 14 then
                        String.toFloat trimmed

                    else
                        SavedSearches.parseIsoMillis trimmed
            in
            case candidate of
                Nothing ->
                    Nothing

                Just ms ->
                    if isNaN ms || isInfinite ms || ms < atParamMinMs || ms > nowMs + atParamFutureSlackMs then
                        Nothing

                    else
                        Just ms


{-| Form-encode one canonical param value, mirroring
`URLSearchParams.toString`: alphanumerics plus `* - . _` survive,
space becomes `+`, everything else is uppercase `%XX` over UTF-8. -}
formEncode : String -> String
formEncode s =
    String.toList s
        |> List.map
            (\c ->
                if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '*' || c == '-' || c == '.' || c == '_' then
                    String.fromChar c

                else if c == ' ' then
                    "+"

                else
                    utf8Percent c
            )
        |> String.concat


{-| Uppercase `%XX` over the UTF-8 bytes of one char. -}
utf8Percent : Char -> String
utf8Percent c =
    let
        code =
            Char.toCode c

        bytes =
            if code < 0x80 then
                [ code ]

            else if code < 0x800 then
                [ 0xC0 + code // 64, 0x80 + modBy 64 code ]

            else if code < 0x10000 then
                [ 0xE0 + code // 4096, 0x80 + modBy 64 (code // 64), 0x80 + modBy 64 code ]

            else
                [ 0xF0 + code // 262144, 0x80 + modBy 64 (code // 4096), 0x80 + modBy 64 (code // 64), 0x80 + modBy 64 code ]
    in
    List.map bytePercent bytes |> String.concat


bytePercent : Int -> String
bytePercent b =
    "%" ++ String.padLeft 2 '0' (hexUnsigned b)


hexUnsigned : Int -> String
hexUnsigned n =
    if n < 16 then
        String.fromChar (hexDigit n)

    else
        hexUnsigned (n // 16) ++ String.fromChar (hexDigit (modBy 16 n))


hexDigit : Int -> Char
hexDigit d =
    case d of
        0 ->
            '0'

        1 ->
            '1'

        2 ->
            '2'

        3 ->
            '3'

        4 ->
            '4'

        5 ->
            '5'

        6 ->
            '6'

        7 ->
            '7'

        8 ->
            '8'

        9 ->
            '9'

        10 ->
            'A'

        11 ->
            'B'

        12 ->
            'C'

        13 ->
            'D'

        14 ->
            'E'

        _ ->
            'F'


{-| A resolved invite card. -}
type alias InviteCard =
    { channel : Maybe String
    , at : Maybe Float
    , topic : Maybe String
    , readerMode : Bool
    , guestName : Maybe String
    , inviter : Maybe String
    , faces : List String
    , network : String
    , url : String
    }


{-| Deduped, validated nicks, capped at three — later lists fill gaps
only. Mirrors `mergeInviteFaces` (case-insensitive dedupe). -}
mergeInviteFaces : List (List String) -> List String
mergeInviteFaces lists =
    let
        step nicks ( seen, faces ) =
            case nicks of
                [] ->
                    ( seen, faces )

                raw :: rest ->
                    if List.length faces >= inviteFaceMax then
                        ( seen, faces )

                    else
                        case parseGuestName (Just raw) of
                            Nothing ->
                                step rest ( seen, faces )

                            Just nick ->
                                let
                                    key =
                                        String.toLower nick
                                in
                                if List.member key seen then
                                    step rest ( seen, faces )

                                else
                                    step rest ( key :: seen, faces ++ [ nick ] )
    in
    List.foldl step ( [], [] ) lists |> Tuple.second


{-| `?with=alice,bob` — comma-separated, each nick re-validated. -}
parseInviteFaces : Maybe String -> List String
parseInviteFaces raw =
    case raw of
        Nothing ->
            []

        Just value ->
            if String.isEmpty value then
                []

            else
                mergeInviteFaces [ String.split "," value ]


{-| Build a card from decoded query values (as `URLSearchParams.get`
returns them), with the canonical share URL. `nowMs` bounds `?at=`. -}
buildInviteCard : Dict String String -> Float -> { network : String, origin : String } -> InviteCard
buildInviteCard params nowMs opts =
    let
        channel =
            parseJoinParam (Dict.get "join" params)

        at =
            parseAtParam nowMs (Dict.get "at" params)

        topic =
            parseTopicParam (Dict.get "topic" params)

        readerMode =
            parseReaderParam (Dict.get "reader" params)

        guestName =
            parseGuestName (Dict.get "as" params)

        inviter =
            parseGuestName (Dict.get "by" params)

        faces =
            parseInviteFaces (Dict.get "with" params)

        encoded =
            List.filterMap identity
                [ Maybe.map (\v -> "join=" ++ formEncode v) channel
                , Maybe.map (\v -> "at=" ++ formEncode (SavedSearches.isoFromMillis v)) at
                , Maybe.map (\v -> "topic=" ++ formEncode v) topic
                , if readerMode then
                    Just "reader=1"

                  else
                    Nothing
                , Maybe.map (\v -> "as=" ++ formEncode v) guestName
                , Maybe.map (\v -> "by=" ++ formEncode v) inviter
                , if List.isEmpty faces then
                    Nothing

                  else
                    Just ("with=" ++ formEncode (String.join "," faces))
                ]

        url =
            if List.isEmpty encoded then
                opts.origin

            else
                opts.origin ++ "?" ++ String.join "&" encoded
    in
    { channel = channel
    , at = at
    , topic = topic
    , readerMode = readerMode
    , guestName = guestName
    , inviter = inviter
    , faces = faces
    , network = opts.network
    , url = url
    }


{-| Card title (`og:title`). -}
inviteTitle : InviteCard -> String
inviteTitle card =
    case card.channel of
        Just channel ->
            "Join " ++ channel ++ " on " ++ card.network

        Nothing ->
            "Join " ++ card.network


{-| Room name is the card title; bare links keep the network name. -}
inviteHeadline : InviteCard -> String
inviteHeadline card =
    case card.channel of
        Just channel ->
            channel

        Nothing ->
            "Join " ++ card.network


{-| Join-door prompt. -}
inviteWelcome : InviteCard -> String
inviteWelcome card =
    case card.channel of
        Just _ ->
            "Choose a display name to walk in."

        Nothing ->
            "Choose a display name, then pick a room once you are in."


{-| Human description (`og:description`). -}
inviteDescription : InviteCard -> String
inviteDescription card =
    let
        target =
            case card.channel of
                Just channel ->
                    channel ++ " on " ++ card.network

                Nothing ->
                    card.network

        head =
            case card.inviter of
                Just who ->
                    who ++ " invited you to " ++ target ++ "."

                Nothing ->
                    "Join " ++ target ++ "."
    in
    case card.topic of
        Just topic ->
            head ++ " " ++ topic

        Nothing ->
            head


{-| One Open Graph tag. -}
type alias OgMeta =
    { property : String
    , content : String
    }


{-| Card Open Graph metadata. -}
inviteOgMeta : InviteCard -> List OgMeta
inviteOgMeta card =
    [ { property = "og:title", content = inviteTitle card }
    , { property = "og:description", content = inviteDescription card }
    , { property = "og:url", content = card.url }
    , { property = "og:type", content = "website" }
    ]


{-| Spec for building a share link inside the app. -}
type alias InviteLinkSpec =
    { channel : String
    , guestName : Maybe String
    , at : Maybe Float
    , topic : Maybe String
    , reader : Bool
    , inviter : Maybe String
    , faces : List String
    }


{-| Origins for the share landing link and the in-app deep link. -}
type alias InviteLinkOpts =
    { network : String
    , origin : String
    , appOrigin : String
    }


{-| The built canonical links plus the validated card. -}
type alias InviteLink =
    { card : InviteCard
    , shareUrl : String
    , appHref : String
    , hasChannel : Bool
    }


{-| Build the canonical share + app links. Never fails on hostile
input: the spec routes through `buildInviteCard`, so malformed fields
drop and a bad channel degrades to a network-only invite. Mirrors
`buildInviteLink` (the app query is sliced from the validated
canonical URL, so build+parse always round-trips). -}
buildInviteLink : InviteLinkSpec -> InviteLinkOpts -> Float -> InviteLink
buildInviteLink spec opts nowMs =
    let
        rawParams =
            List.filterMap identity
                [ if String.isEmpty (String.trim spec.channel) then
                    Nothing

                  else
                    Just ( "join", String.trim spec.channel )
                , Maybe.andThen
                    (\at ->
                        if isNaN at then
                            Nothing

                        else
                            Just ( "at", SavedSearches.isoFromMillis at )
                    )
                    spec.at
                , let
                    topic =
                        Maybe.map String.trim spec.topic |> Maybe.withDefault ""
                  in
                  if String.isEmpty topic then
                    Nothing

                  else
                    Just ( "topic", topic )
                , if spec.reader then
                    Just ( "reader", "1" )

                  else
                    Nothing
                , let
                    guest =
                        Maybe.map String.trim spec.guestName |> Maybe.withDefault ""
                  in
                  if String.isEmpty guest then
                    Nothing

                  else
                    Just ( "as", guest )
                , let
                    by =
                        Maybe.map String.trim spec.inviter |> Maybe.withDefault ""
                  in
                  if String.isEmpty by then
                    Nothing

                  else
                    Just ( "by", by )
                , let
                    faces =
                        List.map String.trim spec.faces |> List.filter (not << String.isEmpty)
                  in
                  if List.isEmpty faces then
                    Nothing

                  else
                    Just ( "with", String.join "," faces )
                ]

        card =
            buildInviteCard (Dict.fromList rawParams) nowMs { network = opts.network, origin = opts.origin }

        query =
            case String.indexes "?" card.url of
                [] ->
                    ""

                i :: _ ->
                    String.dropLeft i card.url
    in
    { card = card
    , shareUrl = card.url
    , appHref = opts.appOrigin ++ query
    , hasChannel = card.channel /= Nothing
    }


{-| Shareable channel-moment link (mirrors `buildMomentLink`): the
origin of the running app with `/app/?join=<channel>&at=<iso>`,
stale paths/queries/hashes dropped. Unparseable origins yield
`Nothing` (fail-closed — no link is ever guessed). -}
buildMomentLink : String -> String -> Float -> Maybe String
buildMomentLink origin channel atMs =
    case String.indexes "://" origin of
        [] ->
            Nothing

        sep :: _ ->
            let
                authority =
                    String.dropLeft (sep + 3) origin
                        |> String.split "/"
                        |> List.head
                        |> Maybe.withDefault ""
            in
            if String.isEmpty authority then
                Nothing

            else
                Just
                    (String.left sep origin
                        ++ "://"
                        ++ authority
                        ++ "/app/?join="
                        ++ formEncode channel
                        ++ "&at="
                        ++ formEncode (SavedSearches.isoFromMillis atMs)
                    )
