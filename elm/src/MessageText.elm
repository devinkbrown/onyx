module MessageText exposing
    ( InlineToken(..)
    , IrcStyle
    , IrcRun
    , Token(..)
    , defaultStyle
    , isDefaultStyle
    , isHttpUrl
    , maxLength
    , parseIrcRuns
    , parseMessage
    , styleCss
    )

{-| Message tokenizer, mirroring `src/lib/format/parseMessage.ts` and
`src/lib/format/ircFormat.ts`.

Pure data: no HTML is produced here. The renderer (`View.MessageText`)
builds safe nodes from each token; link hrefs are re-checked at the sink
(`isHttpUrl`) and colours are palette- or strict-6-hex-resolved, so no
user text ever reaches a `style` value.

Parsing is a single forward scan per range (closing markers are found by
bounded linear look-ahead, never backtracking regexes), input is capped at
4000 characters, and unclosed markers stay literal text.

Indexing is by code point (the oracle indexes UTF-16 units); the only
observable difference is the 4000 cap on astral-heavy input.
-}

import Array exposing (Array)


maxLength : Int
maxLength =
    4000



-- IRC FORMATTING


type alias IrcStyle =
    { bold : Bool
    , italic : Bool
    , underline : Bool
    , strike : Bool
    , monospace : Bool
    , reverse : Bool
    , fg : Maybe String
    , bg : Maybe String
    }


type alias IrcRun =
    { text : String
    , style : IrcStyle
    }


defaultStyle : IrcStyle
defaultStyle =
    { bold = False
    , italic = False
    , underline = False
    , strike = False
    , monospace = False
    , reverse = False
    , fg = Nothing
    , bg = Nothing
    }


isDefaultStyle : IrcStyle -> Bool
isDefaultStyle s =
    s == defaultStyle


mircPalette : Array String
mircPalette =
    Array.fromList
        [ "#ffffff", "#000000", "#00007f", "#009300", "#ff0000", "#7f0000", "#9c009c", "#fc7f00"
        , "#ffff00", "#00fc00", "#009393", "#00ffff", "#0000fc", "#ff00ff", "#7f7f7f", "#d2d2d2"
        , "#470000", "#472100", "#474700", "#324700", "#004700", "#00472c", "#004747", "#002747"
        , "#000047", "#2e0047", "#470047", "#47002a", "#740000", "#743a00", "#747400", "#517400"
        , "#007400", "#007449", "#007474", "#004074", "#000074", "#4b0074", "#740074", "#740045"
        , "#b50000", "#b56300", "#b5b500", "#7db500", "#00b500", "#00b571", "#00b5b5", "#0063b5"
        , "#0000b5", "#7500b5", "#b500b5", "#b5006b", "#ff0000", "#ff8c00", "#ffff00", "#b2ff00"
        , "#00ff00", "#00ffa0", "#00ffff", "#008cff", "#0000ff", "#a500ff", "#ff00ff", "#ff0098"
        , "#ff5959", "#ffb459", "#ffff71", "#cfff60", "#6fff6f", "#65ffc9", "#6dffff", "#59b4ff"
        , "#5959ff", "#c459ff", "#ff66ff", "#ff59bc", "#ff9c9c", "#ffd39c", "#ffff9c", "#e2ff9c"
        , "#9cff9c", "#9cffdb", "#9cffff", "#9cd3ff", "#9c9cff", "#dc9cff", "#ff9cff", "#ff94d3"
        , "#000000", "#131313", "#282828", "#363636", "#4d4d4d", "#656565", "#818181", "#9f9f9f"
        , "#bcbcbc", "#e2e2e2", "#ffffff"
        ]


paletteColor : String -> Maybe String
paletteColor digits =
    String.toInt digits |> Maybe.andThen (\i -> Array.get i mircPalette)


{-| Split `text` into styled runs threading `inStyle`; returns the runs
(control bytes stripped) and the trailing style.
-}
parseIrcRuns : String -> IrcStyle -> { runs : List IrcRun, out : IrcStyle }
parseIrcRuns text inStyle =
    let
        chars =
            Array.fromList (String.toList text)

        at i =
            Array.get i chars

        takeWhileN n pred i acc =
            if String.length acc >= n then
                ( acc, i )

            else
                case at i of
                    Just c ->
                        if pred c then
                            takeWhileN n pred (i + 1) (acc ++ String.fromChar c)

                        else
                            ( acc, i )

                    Nothing ->
                        ( acc, i )

        flush buf style runs =
            if String.isEmpty buf then
                runs

            else
                { text = buf, style = style } :: runs

        go i style buf runs =
            case at i of
                Nothing ->
                    { runs = List.reverse (flush buf style runs), out = style }

                Just c ->
                    let
                        toggled f =
                            go (i + 1) (f style) "" (flush buf style runs)
                    in
                    case Char.toCode c of
                        2 ->
                            toggled (\s -> { s | bold = not s.bold })

                        29 ->
                            toggled (\s -> { s | italic = not s.italic })

                        31 ->
                            toggled (\s -> { s | underline = not s.underline })

                        30 ->
                            toggled (\s -> { s | strike = not s.strike })

                        17 ->
                            toggled (\s -> { s | monospace = not s.monospace })

                        22 ->
                            toggled (\s -> { s | reverse = not s.reverse })

                        15 ->
                            toggled (\_ -> defaultStyle)

                        3 ->
                            let
                                flushed =
                                    flush buf style runs

                                ( fg, j ) =
                                    takeWhileN 2 Char.isDigit (i + 1) ""
                            in
                            if String.isEmpty fg then
                                go j { style | fg = Nothing, bg = Nothing } "" flushed

                            else
                                let
                                    ( bg, k ) =
                                        if at j == Just ',' && Maybe.map Char.isDigit (at (j + 1)) == Just True then
                                            takeWhileN 2 Char.isDigit (j + 1) ""

                                        else
                                            ( "", j )

                                    withFg =
                                        { style | fg = paletteColor fg }

                                    next =
                                        if String.isEmpty bg then
                                            withFg

                                        else
                                            { withFg | bg = paletteColor bg }
                                in
                                go k next "" flushed

                        4 ->
                            let
                                flushed =
                                    flush buf style runs

                                ( fg, j ) =
                                    takeWhileN 6 Char.isHexDigit (i + 1) ""
                            in
                            if String.length fg < 6 then
                                go j { style | fg = Nothing, bg = Nothing } "" flushed

                            else
                                let
                                    withFg =
                                        { style | fg = Just ("#" ++ String.toLower fg) }
                                in
                                if at j == Just ',' then
                                    let
                                        ( bg, k ) =
                                            takeWhileN 6 Char.isHexDigit (j + 1) ""
                                    in
                                    if String.length bg == 6 then
                                        go k { withFg | bg = Just ("#" ++ String.toLower bg) } "" flushed

                                    else
                                        go j withFg "" flushed

                                else
                                    go j withFg "" flushed

                        _ ->
                            go (i + 1) style (buf ++ String.fromChar c) runs
    in
    go 0 inStyle "" []


{-| Inline CSS declarations for a styled run, mirroring `StyledRun`:
reverse swaps fg/bg with the surface/text fallbacks. Values come only
from the palette, validated hex, or fixed keywords.
-}
styleCss : IrcStyle -> List ( String, String )
styleCss s =
    let
        ( fg, bg ) =
            if s.reverse then
                ( Just (Maybe.withDefault "var(--ink)" s.bg), Just (Maybe.withDefault "var(--paper)" s.fg) )

            else
                ( s.fg, s.bg )

        deco =
            List.filterMap identity
                [ if s.underline then
                    Just "underline"

                  else
                    Nothing
                , if s.strike then
                    Just "line-through"

                  else
                    Nothing
                ]
    in
    List.concat
        [ fg |> Maybe.map (\c -> [ ( "color", c ) ]) |> Maybe.withDefault []
        , bg
            |> Maybe.map (\c -> [ ( "background-color", c ), ( "border-radius", "2px" ), ( "padding", "0 2px" ), ( "box-decoration-break", "clone" ) ])
            |> Maybe.withDefault []
        , if s.bold then
            [ ( "font-weight", "700" ) ]

          else
            []
        , if s.italic then
            [ ( "font-style", "italic" ) ]

          else
            []
        , if s.monospace then
            [ ( "font-family", "var(--font-mono)" ) ]

          else
            []
        , if List.isEmpty deco then
            []

          else
            [ ( "text-decoration-line", String.join " " deco ) ]
        ]



-- TOKENS


type InlineToken
    = Text String
    | Code String
    | Link { href : String, text : String }
    | Mention String
    | Channel String
    | Emoji String
    | Bold (List InlineToken)
    | Italic (List InlineToken)
    | Strike (List InlineToken)
    | Spoiler (List InlineToken)
    | Styled IrcStyle (List InlineToken)


type Token
    = Inline InlineToken
    | CodeBlock { text : String, lang : String }
    | Blockquote (List InlineToken)


{-| The sink gate: only literal `http://` / `https://` hrefs go live. -}
isHttpUrl : String -> Bool
isHttpUrl href =
    let
        lower =
            String.toLower href
    in
    (String.startsWith "https://" lower && String.length href > 8)
        || (String.startsWith "http://" lower && String.length href > 7)


type alias Src =
    Array Char


slice : Int -> Int -> Src -> String
slice a b src =
    String.fromList (Array.toList (Array.slice a b src))


charAt : Int -> Src -> Maybe Char
charAt i src =
    Array.get i src


startsWithAt : String -> Int -> Src -> Bool
startsWithAt needle i src =
    slice i (i + String.length needle) src == needle


findClose : Src -> Int -> Int -> String -> Int
findClose src start end close =
    let
        len =
            String.length close

        go i =
            if i > end - len then
                -1

            else if startsWithAt close i src then
                i

            else
                go (i + 1)
    in
    go start


pushText : String -> List InlineToken -> List InlineToken
pushText t tokens =
    if String.isEmpty t then
        tokens

    else
        case tokens of
            (Text prev) :: rest ->
                Text (prev ++ t) :: rest

            _ ->
                Text t :: tokens


isUrlStop : Char -> Bool
isUrlStop c =
    c == ' ' || c == '\t' || c == '\n' || c == '\u{000D}' || c == '<' || c == '>' || c == '"' || c == '\'' || c == '\u{000C}' || c == '\u{000B}'


{-| Scan a URL from `start`, bounded by the enclosing span `len` (the
oracle scans to the end of the whole string, so `**https://x**` swallowed
the closing marker; bounding fixes that divergence on purpose).
-}
scanUrl : Src -> Int -> Int -> Int
scanUrl src start len =
    let

        go i paren bracket =
            if i >= len then
                i

            else
                case charAt i src of
                    Just '(' ->
                        go (i + 1) (paren + 1) bracket

                    Just '[' ->
                        go (i + 1) paren (bracket + 1)

                    Just ')' ->
                        if paren > 0 then
                            go (i + 1) (paren - 1) bracket

                        else
                            i

                    Just ']' ->
                        if bracket > 0 then
                            go (i + 1) paren (bracket - 1)

                        else
                            i

                    Just c ->
                        if isUrlStop c then
                            i

                        else
                            go (i + 1) paren bracket

                    Nothing ->
                        i

        trim i =
            if i > start && List.member (charAt (i - 1) src) (List.map Just [ '.', ',', ';', ':', '!', '?' ]) then
                trim (i - 1)

            else
                i
    in
    trim (go start 0 0)


isWordChar : Char -> Bool
isWordChar c =
    Char.isAlphaNum c && Char.toCode c < 128 || c == '_'


scanWhile : (Char -> Bool) -> Src -> Int -> Int
scanWhile pred src start =
    case charAt start src of
        Just c ->
            if pred c then
                scanWhile pred src (start + 1)

            else
                start

        Nothing ->
            start


isChanEnd : Char -> Bool
isChanEnd c =
    c == ' ' || c == '\t' || c == '\n' || c == '\u{000D}' || String.contains (String.fromChar c) ",;!?'\"()[]{}<>"


{-| Find a single-char italic close that is not part of a doubled marker;
a doubled marker before any single close aborts (mirrors the oracle loop).
-}
findSingleClose : Src -> Int -> Int -> Char -> Int
findSingleClose src start end marker =
    let
        go j =
            if j >= end then
                -1

            else if charAt j src == Just marker then
                if charAt (j + 1) src /= Just marker then
                    j

                else
                    -1

            else
                go (j + 1)
    in
    go start


parseInline : Src -> Int -> Int -> List InlineToken
parseInline src start0 end =
    let
        go i start acc =
            if i >= end then
                List.reverse (pushText (slice start end src) acc)

            else
                let
                    ch =
                        charAt i src

                    next =
                        charAt (i + 1) src

                    container open close wrap =
                        let
                            innerStart =
                                i + String.length open

                            closeAt =
                                findClose src innerStart end close
                        in
                        if closeAt /= -1 && closeAt > innerStart then
                            Just
                                ( closeAt + String.length close
                                , wrap (parseInline src innerStart closeAt) :: pushText (slice start i src) acc
                                )

                        else
                            Nothing

                    single marker =
                        let
                            innerStart =
                                i + 1

                            closeAt =
                                findSingleClose src innerStart end marker
                        in
                        if closeAt /= -1 && closeAt > innerStart then
                            Just ( closeAt + 1, Italic (parseInline src innerStart closeAt) :: pushText (slice start i src) acc )

                        else
                            Nothing

                    attempts =
                        [ \_ ->
                            if ch == Just '`' then
                                let
                                    codeStart =
                                        i + 1

                                    codeEnd =
                                        findClose src codeStart end "`"
                                in
                                if codeEnd /= -1 then
                                    Just ( codeEnd + 1, Code (slice codeStart codeEnd src) :: pushText (slice start i src) acc )

                                else
                                    Nothing

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '*' && next == Just '*' then
                                container "**" "**" Bold

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '_' && next == Just '_' then
                                container "__" "__" Bold

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '~' && next == Just '~' then
                                container "~~" "~~" Strike

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '|' && next == Just '|' then
                                container "||" "||" Spoiler

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '*' && next /= Just '*' then
                                single '*'

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '_' && next /= Just '_' then
                                single '_'

                            else
                                Nothing
                        , \_ ->
                            if (ch == Just 'h' || ch == Just 'H') && (startsWithAt "https://" i src || startsWithAt "http://" i src) then
                                let
                                    schemeEnd =
                                        if startsWithAt "https://" i src then
                                            i + 8

                                        else
                                            i + 7

                                    urlEnd =
                                        scanUrl src schemeEnd end
                                in
                                if urlEnd > schemeEnd then
                                    let
                                        href =
                                            slice i urlEnd src
                                    in
                                    Just ( urlEnd, Link { href = href, text = href } :: pushText (slice start i src) acc )

                                else
                                    Nothing

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '@' then
                                let
                                    nickEnd =
                                        scanWhile (\c -> isWordChar c || c == '-') src (i + 1)
                                in
                                if nickEnd > i + 1 then
                                    Just ( nickEnd, Mention (slice (i + 1) nickEnd src) :: pushText (slice start i src) acc )

                                else
                                    Nothing

                            else
                                Nothing
                        , \_ ->
                            if ch == Just '#' then
                                let
                                    chanEnd =
                                        scanWhile (\c -> not (isChanEnd c)) src (i + 1)
                                in
                                if chanEnd > i + 1 then
                                    Just ( chanEnd, Channel (slice i chanEnd src) :: pushText (slice start i src) acc )

                                else
                                    Nothing

                            else
                                Nothing
                        , \_ ->
                            if ch == Just ':' then
                                let
                                    j =
                                        scanWhile (\c -> isWordChar c || c == '-' || c == '+') src (i + 1)

                                    shortcode =
                                        slice (i + 1) j src
                                in
                                if j > i + 1 && j < end && charAt j src == Just ':' && String.length shortcode <= 64 then
                                    Just ( j + 1, Emoji shortcode :: pushText (slice start i src) acc )

                                else
                                    Nothing

                            else
                                Nothing
                        ]

                    firstHit fns =
                        case fns of
                            [] ->
                                Nothing

                            f :: rest ->
                                case f () of
                                    Just hit ->
                                        Just hit

                                    Nothing ->
                                        firstHit rest
                in
                case firstHit attempts of
                    Just ( nextI, nextAcc ) ->
                        go nextI nextI nextAcc

                    Nothing ->
                        go (i + 1) start acc
    in
    go start0 start0 []


parseStyledInline : String -> IrcStyle -> ( List InlineToken, IrcStyle )
parseStyledInline line inStyle =
    let
        { runs, out } =
            parseIrcRuns line inStyle

        tokens =
            List.concatMap
                (\run ->
                    if String.isEmpty run.text then
                        []

                    else
                        let
                            src =
                                Array.fromList (String.toList run.text)

                            inline =
                                parseInline src 0 (Array.length src)
                        in
                        if isDefaultStyle run.style then
                            inline

                        else
                            [ Styled run.style inline ]
                )
                runs
    in
    ( tokens, out )


{-| Tokenize a raw message (mirrors `parseMessage`). -}
parseMessage : String -> List Token
parseMessage raw =
    let
        capped =
            if String.length raw > maxLength then
                String.left maxLength raw

            else
                raw

        lines =
            Array.fromList (String.split "\n" capped)

        lineCount =
            Array.length lines

        lineAt i =
            Maybe.withDefault "" (Array.get i lines)

        newlineAfter idx =
            if idx < lineCount - 1 then
                [ Inline (Text "\n") ]

            else
                []

        findFence j =
            if j >= lineCount then
                Nothing

            else if String.startsWith "```" (lineAt j) then
                Just j

            else
                findFence (j + 1)

        go idx carry acc =
            if idx >= lineCount then
                List.concat (List.reverse acc)

            else
                let
                    line =
                        lineAt idx
                in
                if String.startsWith "> " line || line == ">" then
                    let
                        ( children, out ) =
                            parseStyledInline (String.dropLeft 2 line) carry
                    in
                    go (idx + 1) out ((Blockquote children :: newlineAfter idx) :: acc)

                else if String.startsWith "```" line then
                    case findFence (idx + 1) of
                        Just closeIdx ->
                            let
                                body =
                                    List.range (idx + 1) (closeIdx - 1)
                                        |> List.map lineAt
                                        |> String.join "\n"
                            in
                            go (closeIdx + 1) defaultStyle ((CodeBlock { text = body, lang = String.trim (String.dropLeft 3 line) } :: newlineAfter closeIdx) :: acc)

                        Nothing ->
                            let
                                ( inline, out ) =
                                    parseStyledInline line defaultStyle
                            in
                            go (idx + 1) out ((List.map Inline inline ++ newlineAfter idx) :: acc)

                else
                    let
                        ( inline, out ) =
                            parseStyledInline line carry
                    in
                    go (idx + 1) out ((List.map Inline inline ++ newlineAfter idx) :: acc)
    in
    go 0 defaultStyle []
