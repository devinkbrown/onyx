module MessageTextTest exposing (suite)

{-| Vectors mirroring `src/lib/format/parseMessage.test.ts` and
`ircFormat.test.ts`: every token type, nesting, unclosed markers, URL
trailing-punctuation rules, code fences, blockquotes, mIRC colour/hex
runs with carry, and the http(s)-only sink gate.
-}

import Expect
import MessageText exposing (..)
import Test exposing (Test, describe, test)


flatten : List Token -> List InlineToken
flatten tokens =
    let
        inline t =
            t
                :: (case t of
                        Bold c ->
                            List.concatMap inline c

                        Italic c ->
                            List.concatMap inline c

                        Strike c ->
                            List.concatMap inline c

                        Spoiler c ->
                            List.concatMap inline c

                        Styled _ c ->
                            List.concatMap inline c

                        _ ->
                            []
                   )
    in
    List.concatMap
        (\t ->
            case t of
                Inline i ->
                    inline i

                Blockquote c ->
                    List.concatMap inline c

                CodeBlock _ ->
                    []
        )
        tokens


count : (InlineToken -> Bool) -> String -> Int
count pred raw =
    List.length (List.filter pred (flatten (parseMessage raw)))


isBold : InlineToken -> Bool
isBold t =
    case t of
        Bold _ ->
            True

        _ ->
            False


isItalic : InlineToken -> Bool
isItalic t =
    case t of
        Italic _ ->
            True

        _ ->
            False


isLink : InlineToken -> Bool
isLink t =
    case t of
        Link _ ->
            True

        _ ->
            False


links : String -> List String
links raw =
    List.filterMap
        (\t ->
            case t of
                Link l ->
                    Just l.href

                _ ->
                    Nothing
        )
        (flatten (parseMessage raw))


blockquotes : String -> Int
blockquotes raw =
    List.length
        (List.filter
            (\t ->
                case t of
                    Blockquote _ ->
                        True

                    _ ->
                        False
            )
            (parseMessage raw)
        )


suite : Test
suite =
    describe "MessageText"
        [ describe "plain"
            [ test "plain text is one token" <|
                \_ -> Expect.equal [ Inline (Text "hello world") ] (parseMessage "hello world")
            , test "empty input is empty" <|
                \_ -> Expect.equal [] (parseMessage "")
            , test "unicode survives" <|
                \_ -> Expect.equal [ Inline (Text "こんにちは 🌊") ] (parseMessage "こんにちは 🌊")
            , test "newlines become their own text tokens" <|
                \_ -> Expect.equal [ Inline (Text "line one"), Inline (Text "\n"), Inline (Text "line two") ] (parseMessage "line one\nline two")
            ]
        , describe "emphasis"
            [ test "**bold**" <|
                \_ -> Expect.equal [ Inline (Text "hello "), Inline (Bold [ Text "world" ]), Inline (Text "!") ] (parseMessage "hello **world**!")
            , test "__bold__" <|
                \_ -> Expect.equal [ Inline (Bold [ Text "bold text" ]) ] (parseMessage "__bold text__")
            , test "unclosed ** is literal" <|
                \_ -> Expect.equal [ Inline (Text "not **bold") ] (parseMessage "not **bold")
            , test "empty markers are not tokens" <|
                \_ -> Expect.equal [ 0, 0, 0, 0 ] [ count isBold "****", count isBold "__", count (\t -> t == Strike []) "~~", count (\t -> t == Spoiler []) "||" ]
            , test "*italic* and _italic_" <|
                \_ -> Expect.equal [ 1, 1 ] [ count isItalic "this is *italic* text", count isItalic "_slanted_" ]
            , test "unclosed * is literal" <|
                \_ -> Expect.equal 0 (count isItalic "not *italic")
            , test "~~strike~~" <|
                \_ -> Expect.equal [ Inline (Strike [ Text "deleted" ]) ] (parseMessage "~~deleted~~")
            , test "||spoiler||" <|
                \_ -> Expect.equal [ Inline (Spoiler [ Text "secret content" ]) ] (parseMessage "||secret content||")
            , test "bold contains italic" <|
                \_ -> Expect.equal [ 1, 1 ] [ count isBold "**hello *world* end**", count isItalic "**hello *world* end**" ]
            , test "spoiler contains a mention" <|
                \_ -> Expect.equal [ Inline (Spoiler [ Mention "secret" ]) ] (parseMessage "||@secret||")
            ]
        , describe "code"
            [ test "inline code" <|
                \_ -> Expect.equal [ Inline (Text "run "), Inline (Code "npm install"), Inline (Text " first") ] (parseMessage "run `npm install` first")
            , test "no markup inside inline code" <|
                \_ -> Expect.equal [ Inline (Code "**not bold**") ] (parseMessage "`**not bold**`")
            , test "unclosed backtick is literal" <|
                \_ -> Expect.equal [ Inline (Text "`unclosed") ] (parseMessage "`unclosed")
            , test "fenced block with language" <|
                \_ -> Expect.equal [ CodeBlock { text = "const x = 1;", lang = "typescript" } ] (parseMessage "```typescript\nconst x = 1;\n```")
            , test "fenced block without language keeps inner newlines" <|
                \_ -> Expect.equal [ CodeBlock { text = "hello\nworld", lang = "" } ] (parseMessage "```\nhello\nworld\n```")
            , test "unclosed fence falls back to inline text" <|
                \_ ->
                    let
                        tokens =
                            parseMessage "```\nno close"
                    in
                    Expect.equal True (List.member (Inline (Text "no close")) tokens && not (List.any (\t -> case t of
                                                                                                        CodeBlock _ ->
                                                                                                            True

                                                                                                        _ ->
                                                                                                            False
                                                                                                   ) tokens))
            ]
        , describe "blockquote"
            [ test "a quoted line" <|
                \_ -> Expect.equal [ Blockquote [ Text "a quoted line" ] ] (parseMessage "> a quoted line")
            , test "only at line start" <|
                \_ -> Expect.equal 0 (blockquotes "not > a quote")
            , test "bare > is an empty quote" <|
                \_ -> Expect.equal [ Blockquote [] ] (parseMessage ">")
            , test "mixes with normal lines" <|
                \_ -> Expect.equal [ Blockquote [ Text "quoted" ], Inline (Text "\n"), Inline (Text "normal line") ] (parseMessage "> quoted\nnormal line")
            ]
        , describe "links"
            [ test "https in prose" <|
                \_ -> Expect.equal [ "https://example.com" ] (links "check https://example.com out")
            , test "http" <|
                \_ -> Expect.equal [ "http://example.com" ] (links "http://example.com")
            , test "trailing period stripped" <|
                \_ -> Expect.equal [ "https://example.com" ] (links "see https://example.com.")
            , test "mid-URL comma kept" <|
                \_ -> Expect.equal [ "https://example.com,foo" ] (links "at https://example.com,foo")
            , test "trailing comma stripped" <|
                \_ -> Expect.equal [ "https://example.com/path" ] (links "see https://example.com/path,")
            , test "balanced parens kept" <|
                \_ -> Expect.equal [ "https://en.wikipedia.org/wiki/Foo_(bar)" ] (links "https://en.wikipedia.org/wiki/Foo_(bar)")
            , test "unbalanced close paren ends the URL" <|
                \_ -> Expect.equal [ "https://example.com" ] (links "(see https://example.com)")
            , test "query string kept" <|
                \_ -> Expect.equal [ "https://example.com/search?q=foo&bar=1" ] (links "https://example.com/search?q=foo&bar=1")
            , test "two URLs" <|
                \_ -> Expect.equal 2 (count isLink "https://a.com and https://b.com")
            , test "bold contains a link" <|
                \_ -> Expect.equal [ Inline (Bold [ Link { href = "https://example.com", text = "https://example.com" } ]) ] (parseMessage "**https://example.com**")
            , test "a bare scheme is not a link" <|
                \_ -> Expect.equal 0 (count isLink "https:// nothing")
            , test "javascript: never becomes a link" <|
                \_ -> Expect.equal 0 (count isLink "javascript:alert(1)")
            , test "sink gate accepts only http(s)" <|
                \_ -> Expect.equal [ True, True, False, False, False ] (List.map isHttpUrl [ "https://a.b", "HTTP://a.b", "javascript:alert(1)", "data:text/html,x", "https://" ])
            ]
        , describe "mentions, channels, emoji"
            [ test "@nick stops at punctuation" <|
                \_ -> Expect.equal [ Inline (Text "hello "), Inline (Mention "alice"), Inline (Text "!") ] (parseMessage "hello @alice!")
            , test "nick with hyphen and underscore" <|
                \_ -> Expect.equal [ Inline (Mention "john_doe-42") ] (parseMessage "@john_doe-42")
            , test "bare @ is literal" <|
                \_ -> Expect.equal [ Inline (Text "@ alone") ] (parseMessage "@ alone")
            , test "#channel" <|
                \_ -> Expect.equal [ Inline (Text "join "), Inline (Channel "#general"), Inline (Text " please") ] (parseMessage "join #general please")
            , test "bare # is literal" <|
                \_ -> Expect.equal [ Inline (Text "# heading") ] (parseMessage "# heading")
            , test ":smile:" <|
                \_ -> Expect.equal [ Inline (Text "hello "), Inline (Emoji "smile") ] (parseMessage "hello :smile:")
            , test ":+1:" <|
                \_ -> Expect.equal [ Inline (Emoji "+1") ] (parseMessage ":+1:")
            , test "::: is not an emoji" <|
                \_ -> Expect.equal [ Inline (Text ":::") ] (parseMessage ":::")
            , test "an over-long shortcode is literal" <|
                \_ ->
                    let
                        raw =
                            ":" ++ String.repeat 65 "a" ++ ":"
                    in
                    Expect.equal [ Inline (Text raw) ] (parseMessage raw)
            ]
        , describe "mIRC formatting"
            [ test "bold toggles strip the control bytes" <|
                \_ ->
                    Expect.equal [ Inline (Text "a "), Inline (Styled { defaultStyle | bold = True } [ Text "b" ]), Inline (Text " c") ]
                        (parseMessage "a \u{0002}b\u{0002} c")
            , test "palette colour with background" <|
                \_ ->
                    Expect.equal [ { text = "red", style = { defaultStyle | fg = Just "#ff0000", bg = Just "#000000" } } ]
                        (parseIrcRuns "\u{0003}04,01red" defaultStyle).runs
            , test "bare ^C clears colours" <|
                \_ ->
                    Expect.equal [ { text = "x", style = { defaultStyle | fg = Just "#ff0000" } }, { text = "y", style = defaultStyle } ]
                        (parseIrcRuns "\u{0003}4x\u{0003}y" defaultStyle).runs
            , test "out-of-range index is default colour" <|
                \_ ->
                    Expect.equal [ { text = "z", style = defaultStyle } ] (parseIrcRuns "\u{0003}99z" defaultStyle).runs
            , test "hex colour lowercases" <|
                \_ ->
                    Expect.equal [ { text = "h", style = { defaultStyle | fg = Just "#aabbcc" } } ] (parseIrcRuns "\u{0004}AABBCCh" defaultStyle).runs
            , test "malformed hex clears" <|
                \_ ->
                    Expect.equal [ { text = "q", style = defaultStyle } ] (parseIrcRuns "\u{0004}12q" defaultStyle).runs
            , test "reset clears everything" <|
                \_ ->
                    Expect.equal { defaultStyle | italic = False } (parseIrcRuns "\u{0002}\u{001D}a\u{000F}" defaultStyle).out
            , test "style carries across lines" <|
                \_ ->
                    Expect.equal [ Inline (Styled { defaultStyle | bold = True } [ Text "one" ]), Inline (Text "\n"), Inline (Styled { defaultStyle | bold = True } [ Text "two" ]) ]
                        (parseMessage "\u{0002}one\ntwo")
            , test "reverse swaps to surface defaults" <|
                \_ ->
                    Expect.equal [ ( "color", "var(--ink)" ), ( "background-color", "var(--paper)" ), ( "border-radius", "2px" ), ( "padding", "0 2px" ), ( "box-decoration-break", "clone" ) ]
                        (styleCss { defaultStyle | reverse = True })
            ]
        , describe "bounds"
            [ test "input caps at 4000 characters" <|
                \_ -> Expect.equal [ Inline (Text (String.repeat maxLength "a")) ] (parseMessage (String.repeat 5000 "a"))
            , test "many unclosed markers stay literal" <|
                \_ ->
                    let
                        raw =
                            String.repeat 300 "**_~~||"
                    in
                    Expect.equal 0 (count isLink raw)
            ]
        ]
