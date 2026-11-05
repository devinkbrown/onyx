module NickComplete exposing
    ( NickToken
    , applyNickCompletion
    , cycleNickCompletion
    , isNickChar
    , nickTokenAt
    , rankNickCompletions
    )

{-| Composer nick completion. Port of `src/lib/composer/nickComplete.ts`.
Indexes are Elm code points. ASCII vectors match the oracle's UTF-16
indexes; a non-BMP caret is the documented code-point narrowing.
-}


type alias NickToken =
    { start : Int
    , end : Int
    , at : Bool
    , query : String
    }


isNickChar : Char -> Bool
isNickChar ch =
    let
        code =
            Char.toCode ch
    in
    (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || List.member ch [ '-', '[', ']', ',', '\\', '`', '^', '{', '}', '|', '_' ]


nickTokenAt : String -> Int -> Maybe NickToken
nickTokenAt text caret =
    if caret < 0 || caret > String.length text then
        Nothing

    else if String.startsWith "/" text && not (String.any isSpace (String.slice 1 (max 1 caret) text)) then
        Nothing

    else
        let
            end =
                extendRight text caret

            start0 =
                extendLeft text end
        in
        if start0 == end then
            Nothing

        else
            let
                ( start, at ) =
                    if start0 > 0 && String.slice (start0 - 1) start0 text == "@" then
                        ( start0 - 1, True )

                    else
                        ( start0, False )

                blocked =
                    if start > 0 then
                        case String.uncons (String.slice (start - 1) start text) of
                            Just ( prev, _ ) ->
                                isNickChar prev || prev == '@'

                            Nothing ->
                                False

                    else
                        False

                raw =
                    String.slice start end text

                query =
                    if at then
                        String.dropLeft 1 raw

                    else
                        raw
            in
            if blocked || (String.isEmpty query && not at) then
                Nothing

            else
                Just { start = start, end = end, at = at, query = query }


rankNickCompletions : String -> List String -> Int -> List String
rankNickCompletions query nicks limit =
    let
        needle =
            String.toLower query

        hits =
            List.foldl
                (\nick ( seen, acc ) ->
                    let
                        key =
                            String.toLower nick
                    in
                    if String.isEmpty nick || List.member key seen then
                        ( seen, acc )

                    else if String.isEmpty needle || String.startsWith needle key then
                        ( key :: seen, nick :: acc )

                    else
                        ( seen, acc )
                )
                ( [], [] )
                nicks
                |> Tuple.second
                |> List.reverse
    in
    hits
        |> List.sortWith (rankCompare query)
        |> List.take (max 1 limit)


applyNickCompletion : String -> NickToken -> String -> { text : String, caret : Int }
applyNickCompletion text token nick =
    let
        insert =
            (if token.at then
                "@"

             else
                ""
            )
                ++ nick
                ++ " "

        next =
            String.left token.start text ++ insert ++ String.dropLeft token.end text
    in
    { text = next, caret = token.start + String.length insert }


cycleNickCompletion : String -> Int -> List String -> Int -> Maybe { text : String, caret : Int, index : Int, matches : List String }
cycleNickCompletion text caret nicks previousIndex =
    nickTokenAt text caret
        |> Maybe.andThen
            (\token ->
                let
                    matches =
                        rankNickCompletions token.query nicks 8
                in
                case matches of
                    [] ->
                        Nothing

                    _ ->
                        let
                            index =
                                if previousIndex < 0 then
                                    0

                                else
                                    modBy (List.length matches) (previousIndex + 1)

                            chosen =
                                matches |> List.drop index |> List.head |> Maybe.withDefault ""

                            applied =
                                applyNickCompletion text token chosen
                        in
                        Just { text = applied.text, caret = applied.caret, index = index, matches = matches }
            )


isSpace : Char -> Bool
isSpace c =
    c == ' ' || c == '\n' || c == '\t' || c == '\u{000D}'


extendRight : String -> Int -> Int
extendRight text index =
    if index >= String.length text then
        index

    else
        case String.uncons (String.dropLeft index text) of
            Just ( c, _ ) ->
                if isNickChar c then
                    extendRight text (index + 1)

                else
                    index

            Nothing ->
                index


extendLeft : String -> Int -> Int
extendLeft text index =
    if index <= 0 then
        index

    else
        case String.uncons (String.slice (index - 1) index text) of
            Just ( c, _ ) ->
                if isNickChar c then
                    extendLeft text (index - 1)

                else
                    index

            Nothing ->
                index


rankCompare : String -> String -> String -> Order
rankCompare query a b =
    let
        aPref =
            if String.startsWith query a then
                0

            else
                1

        bPref =
            if String.startsWith query b then
                0

            else
                1
    in
    if aPref /= bPref then
        compare aPref bPref

    else if String.length a /= String.length b then
        compare (String.length a) (String.length b)

    else
        compare a b
