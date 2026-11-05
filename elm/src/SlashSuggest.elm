module SlashSuggest exposing
    ( Command
    , complete
    , query
    , suggestions
    )

{-| Composer slash suggestions. Port of `slashCommandQuery`,
`getSlashCommandSuggestions`, and `completeSlashCommand` in
`src/lib/commands/registry.ts`.
-}


type alias Command =
    { name : String
    , usage : String
    , description : String
    , aliases : List String
    , insertText : Maybe String
    , oper : Bool
    , textCommand : Bool
    }


query : String -> Maybe String
query text =
    if not (String.startsWith "/" text) || String.startsWith "//" text then
        Nothing

    else
        let
            rest =
                String.dropLeft 1 text

            token =
                takeUntilSpace rest
        in
        if String.isEmpty token then
            Just ""

        else if String.any isSpace (String.left (String.length token + 1) rest) then
            Nothing

        else
            Just (String.toLower token)


suggestions : List Command -> String -> Int -> Bool -> List Command
suggestions commands text limit isOper =
    case query text of
        Nothing ->
            []

        Just needle ->
            commands
                |> List.filter
                    (\command ->
                        (not command.oper || isOper)
                            && (String.startsWith needle command.name
                                    || List.any (\alias -> String.startsWith needle alias) command.aliases
                               )
                    )
                |> List.take (max 0 limit)


complete : String -> Command -> String
complete input command =
    let
        rest =
            case String.uncons input of
                Just ( '/', after ) ->
                    String.trimLeft (dropUntilSpace after)

                _ ->
                    String.trimLeft input
    in
    case ( command.textCommand, command.insertText ) of
        ( True, Just insert ) ->
            if String.isEmpty rest then
                insert

            else
                insert ++ " " ++ rest

        _ ->
            if String.isEmpty rest then
                "/" ++ command.name ++ " "

            else
                "/" ++ command.name ++ " " ++ rest


isSpace : Char -> Bool
isSpace c =
    c == ' ' || c == '\n' || c == '\t' || c == '\u{000D}' || c == '\u{000B}' || c == '\u{000C}'


takeUntilSpace : String -> String
takeUntilSpace text =
    case String.uncons text of
        Just ( c, rest ) ->
            if isSpace c then
                ""

            else
                String.cons c (takeUntilSpace rest)

        Nothing ->
            ""


dropUntilSpace : String -> String
dropUntilSpace text =
    case String.uncons text of
        Just ( c, rest ) ->
            if isSpace c then
                text

            else
                dropUntilSpace rest

        Nothing ->
            ""
