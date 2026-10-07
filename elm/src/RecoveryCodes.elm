module RecoveryCodes exposing
    ( RecoveryCodeLine
    , RecoveryCodesStatus
    , isRecoveryCodesCleared
    , isRecoveryCodesGenerated
    , isRecoveryCodesLoginOk
    , normalizeRecoveryCodeInput
    , parseRecoveryCodeLine
    , parseRecoveryCodesStatus
    )

{-| Pure parse helpers for RECOVERYCODES notices/FAIL replies — Elm port
of `src/lib/irc/recoveryCodes.ts`.

Wire (server NOTICE / FAIL):
`RECOVERYCODES: 3 unused codes` / `RECOVERYCODES: generated 10
single-use codes — …` / `RECOVERYCODES: 1. ABCDE-FGHIJ` /
`RECOVERYCODES: login ok — …` / `RECOVERYCODES: all recovery codes
cleared` / `FAIL RECOVERYCODES AUTH_FAILED :…`
-}


type alias RecoveryCodesStatus =
    { remaining : Int
    }


type alias RecoveryCodeLine =
    { index : Int
    , code : String
    }


{-| Crockford base32 body (server alphabet, no I/L/O/U). -}
isCodeBodyChar : Char -> Bool
isCodeBodyChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x48)
        || (code >= 0x4A && code <= 0x4B)
        || (code >= 0x4D && code <= 0x4E)
        || (code >= 0x50 && code <= 0x54)
        || (code >= 0x56 && code <= 0x5A)


stripHeader : String -> Maybe String
stripHeader text =
    let
        trimmed =
            String.trim text

        upper =
            String.toUpper trimmed
    in
    if String.startsWith "RECOVERYCODES:" upper then
        Just (String.trimLeft (String.dropLeft (String.length "RECOVERYCODES:") trimmed))

    else
        Nothing


takeDigits : String -> ( String, String )
takeDigits text =
    takeDigitsGo (String.toList text) []


takeDigitsGo : List Char -> List Char -> ( String, String )
takeDigitsGo chars acc =
    case chars of
        [] ->
            ( String.fromList (List.reverse acc), "" )

        c :: rest ->
            let
                code =
                    Char.toCode c
            in
            if code >= 0x30 && code <= 0x39 then
                takeDigitsGo rest (c :: acc)

            else
                ( String.fromList (List.reverse acc), String.fromList (c :: rest) )


isWhitespace : Char -> Bool
isWhitespace c =
    Char.toCode c <= 0x20


parseRecoveryCodesStatus : String -> Maybe RecoveryCodesStatus
parseRecoveryCodesStatus text =
    case stripHeader text of
        Nothing ->
            Nothing

        Just rest ->
            let
                ( digits, tail ) =
                    takeDigits rest
            in
            if String.isEmpty digits then
                Nothing

            else
                case String.toInt digits of
                    Just remaining ->
                        if remaining < 0 then
                            Nothing

                        else
                            -- The oracle requires \s+ (one or more) between
                            -- the count and "unused code".
                            case String.uncons tail of
                                Just ( first, _ ) ->
                                    if not (isWhitespace first) then
                                        Nothing

                                    else if String.startsWith "UNUSED CODE" (String.toUpper (String.trimLeft tail)) then
                                        Just { remaining = remaining }

                                    else
                                        Nothing

                                Nothing ->
                                    Nothing

                    Nothing ->
                        Nothing


parseRecoveryCodeLine : String -> Maybe RecoveryCodeLine
parseRecoveryCodeLine text =
    case stripHeader text of
        Nothing ->
            Nothing

        Just rest ->
            let
                ( digits, tail ) =
                    takeDigits rest
            in
            if String.isEmpty digits then
                Nothing

            else
                case String.toInt digits of
                    Just index ->
                        if index <= 0 then
                            Nothing

                        else if not (String.startsWith "." tail) then
                            Nothing

                        else
                            let
                                code =
                                    String.trim (String.dropLeft 1 tail)
                            in
                            if String.length code == 11 && isDashedCode code then
                                Just { index = index, code = String.toUpper code }

                            else
                                Nothing

                    Nothing ->
                        Nothing


isDashedCode : String -> Bool
isDashedCode code =
    case String.toList (String.toUpper code) of
        [ a, b, c, d, e, dash, f, g, h, i, j ] ->
            dash == '-' && List.all isCodeBodyChar [ a, b, c, d, e, f, g, h, i, j ]

        _ ->
            False


startsWithHeaderWord : String -> String -> Bool
startsWithHeaderWord word text =
    case stripHeader text of
        Just rest ->
            String.startsWith word (String.toUpper rest)

        Nothing ->
            False


isRecoveryCodesGenerated : String -> Bool
isRecoveryCodesGenerated text =
    startsWithHeaderWord "GENERATED" text


isRecoveryCodesLoginOk : String -> Bool
isRecoveryCodesLoginOk text =
    startsWithHeaderWord "LOGIN OK" text


isRecoveryCodesCleared : String -> Bool
isRecoveryCodesCleared text =
    startsWithHeaderWord "ALL RECOVERY CODES CLEARED" text


{-| Normalize user input to undashed uppercase code body for LOGIN. -}
normalizeRecoveryCodeInput : String -> String
normalizeRecoveryCodeInput raw =
    raw
        |> String.toList
        |> List.filter (\c -> c /= '-' && not (isWhitespace c))
        |> String.fromList
        |> String.toUpper
