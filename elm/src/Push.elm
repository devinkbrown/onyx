module Push exposing
    ( enableReadiness
    , ownerKey
    , pushOffToast
    , pushOnToast
    , pushUnavailableToast
    , recoverReadiness
    , vapidKeyBytes
    )

{-| Web-push subscription against the server's WEBPUSH command — Elm
port of the pure gates in `src/lib/notifications/webPush.ts`.

The browser half (PushManager, notification permission, the
owner/intent localStorage markers, and the SUBSCRIBE/UNSUBSCRIBE
lines) lives behind ports: Elm owns VAPID shape validation, the
enable/recover gate order with the oracle's typed reasons, the
owner-key encoding, and the toast copy. Guests can never subscribe:
every gate requires a signed-in account.
-}

import Base64Url


{-| Uncompressed P-256 point length the PushManager requires
(`0x04 ‖ X ‖ Y`). -}
vapidKeyBytesLength : Int
vapidKeyBytesLength =
    65


isB64UrlChar : Char -> Bool
isB64UrlChar char =
    Char.isAlphaNum char || char == '-' || char == '_'


{-| The VAPID application-server key from ISUPPORT: strict base64url
(no standard-base64 aliases, no padding) decoding to exactly 65
bytes starting with `0x04`. Anything else is `Nothing` (mirroring
`applicationServerKeyFromIsupport`). -}
vapidKeyBytes : String -> Maybe (List Int)
vapidKeyBytes value =
    if String.isEmpty value || not (String.all isB64UrlChar value) then
        Nothing

    else
        case Base64Url.decode value of
            Just bytes ->
                if List.length bytes == vapidKeyBytesLength && List.head bytes == Just 4 then
                    Just bytes

                else
                    Nothing

            Nothing ->
                Nothing


{-| Escape one JSON string (mirroring `JSON.stringify` for the
owner-key pair: quotes, backslashes, and control characters). -}
escapeJsonString : String -> String
escapeJsonString value =
    String.foldl
        (\char acc ->
            case char of
                '"' ->
                    acc ++ "\\\""

                '\\' ->
                    acc ++ "\\\\"

                '\n' ->
                    acc ++ "\\n"

                '\u{000D}' ->
                    acc ++ "\\r"

                '\t' ->
                    acc ++ "\\t"

                '\u{0008}' ->
                    acc ++ "\\b"

                '\u{000C}' ->
                    acc ++ "\\f"

                _ ->
                    let
                        code =
                            Char.toCode char
                    in
                    if code < 0x20 then
                        acc ++ "\\u" ++ String.padLeft 4 '0' (hexOf code)

                    else
                        acc ++ String.fromChar char
        )
        ""
        value


hexOf : Int -> String
hexOf n =
    if n < 16 then
        String.fromChar (hexDigit n)

    else
        hexOf (n // 16) ++ String.fromChar (hexDigit (modBy 16 n))


hexDigit : Int -> Char
hexDigit n =
    case n of
        10 ->
            'a'

        11 ->
            'b'

        12 ->
            'c'

        13 ->
            'd'

        14 ->
            'e'

        15 ->
            'f'

        _ ->
            Char.fromCode (Char.toCode '0' + n)


{-| The stable owner key shared with the ports marker store:
`[serverUrl, lowercased-identity]` JSON, mirroring
`deviceMemoryOwnerKey` (trimmed, non-empty, length-capped). -}
ownerKey : { serverUrl : String, identity : String } -> Maybe String
ownerKey owner =
    let
        serverUrl =
            String.trim owner.serverUrl

        identity =
            String.toLower (String.trim owner.identity)
    in
    if String.isEmpty serverUrl || String.length serverUrl > 2048 then
        Nothing

    else if String.isEmpty identity || String.length identity > 256 then
        Nothing

    else
        Just ("[\"" ++ escapeJsonString serverUrl ++ "\",\"" ++ escapeJsonString identity ++ "\"]")


{-| Enable gate order (load-bearing, mirroring `registerWebPush`):
supported → signed-in account → connected session → VAPID advertised
→ VAPID shape. Permission prompts and intent stay ports-side. -}
enableReadiness :
    { supported : Bool
    , account : Maybe String
    , connected : Bool
    , vapid : String
    }
    -> Result String (List Int)
enableReadiness input =
    if not input.supported then
        Err "This browser does not support push."

    else
        case input.account of
            Nothing ->
                Err "Sign in first — push is tied to your account."

            Just account ->
                if String.isEmpty (String.trim account) then
                    Err "Sign in first — push is tied to your account."

                else if not input.connected then
                    Err "Reconnect first."

                else if String.isEmpty input.vapid then
                    Err "Push is not enabled on this server."

                else
                    case vapidKeyBytes input.vapid of
                        Just key ->
                            Ok key

                        Nothing ->
                            Err "Push is misconfigured on this server."


{-| Recover additionally requires the prior opt-in (mirroring the
`recover` intent check). -}
recoverReadiness : { intentDesired : Bool } -> Result String ()
recoverReadiness input =
    if input.intentDesired then
        Ok ()

    else
        Err "Push is not enabled on this browser."


{-| Toast copy for a completed toggle (mirroring `handleWebPushToggle`
and `closedTabArmedToast`). -}
pushOnToast : { title : String, description : String }
pushOnToast =
    { title = "Push on"
    , description = "Mentions, DMs, and calls can reach this browser when the tab is closed."
    }


pushOffToast : { title : String, description : String }
pushOffToast =
    { title = "Push off"
    , description = "This browser will no longer be pinged for mentions, DMs, or calls while closed."
    }


pushUnavailableToast : String -> { title : String, description : String }
pushUnavailableToast reason =
    { title = "Push unavailable"
    , description = reason
    }
