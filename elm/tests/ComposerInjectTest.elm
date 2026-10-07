module ComposerInjectTest exposing (suite)

{-| Vectors mirroring `src/lib/composer/composerInject.test.ts`
(sanitize, quote/mention formats, append/prefix/replace merges).
-}

import ComposerInject exposing (..)
import Expect
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "ComposerInject"
        [ test "sanitizes control characters and bounds length" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "hithere" (sanitizeComposerFragment "hi\u{0000}there\n" 400)
                    , \_ -> Expect.equal 400 (String.length (sanitizeComposerFragment (String.repeat 500 "a") 400))
                    ]
                    ()
        , test "formats multi-line quotes with attribution body" <|
            \_ ->
                Expect.equal "> hello\n> world\n\n" (formatQuoteInsert "Alice" "hello\nworld")
        , test "formats empty quote as attribution stub" <|
            \_ ->
                Expect.equal "> (Bob)\n\n" (formatQuoteInsert "Bob" "  ")
        , test "formats @mention with trailing space" <|
            \_ ->
                Expect.equal "@kain " (formatMentionInsert "kain")
        , test "merges append / prefix / replace" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { text = "hi there", caret = 8 } (mergeComposerInsert "hi" "there" InjectAppend)
                    , \_ -> Expect.equal { text = "@x body", caret = 3 } (mergeComposerInsert "body" "@x " InjectPrefix)
                    , \_ -> Expect.equal { text = "new", caret = 3 } (mergeComposerInsert "old" "new" InjectReplace)
                    ]
                    ()
        ]
