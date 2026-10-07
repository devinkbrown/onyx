module EmojiTest exposing (suite)

{-| Oracle-mirrored vectors for emoji search (mirroring
`src/lib/emoji/emoji.test.ts`). -}

import Emoji exposing (..)
import Expect
import Test exposing (Test, describe, test)


shortcodes : List EmojiEntry -> List String
shortcodes entries =
    List.map .shortcode entries


suite : Test
suite =
    describe "Emoji"
        [ describe "emojiList"
            [ test "publishes entries with shortcode, unicode emoji, and keywords" <|
                \_ ->
                    Expect.equal
                        (Just { emoji = "💙", shortcode = "blue_heart", keywords = [ "love", "ocean" ] })
                        (List.filter (\entry -> entry.shortcode == "blue_heart") emojiList |> List.head)
            , test "does not publish duplicate shortcode keys" <|
                \_ ->
                    let
                        codes =
                            List.map .shortcode emojiList
                    in
                    Expect.equal (List.length codes) (List.length (List.foldl (\code acc -> if List.member code acc then acc else code :: acc) [] codes))
            ]
        , describe "searchEmojis"
            [ test "returns the leading emoji entries for an empty query" <|
                \_ ->
                    Expect.equal [ "grinning", "joy", "blush" ] (shortcodes (searchEmojis "" 3))
            , test "treats a colon-only query as empty and still honors the limit" <|
                \_ ->
                    Expect.equal [ "grinning", "joy" ] (shortcodes (searchEmojis " : " 2))
            , test "does not unwrap malformed nested colon queries into a known shortcode" <|
                \_ ->
                    Expect.equal [] (searchEmojis "::rocket::" 48)
            , test "trims whitespace and strips surrounding colons from shortcode queries" <|
                \_ ->
                    Expect.equal [ "rocket" ] (shortcodes (searchEmojis "  :rocket:  " 48))
            , test "matches shortcode fragments case-insensitively" <|
                \_ ->
                    Expect.equal [ "heart_eyes", "heart", "blue_heart" ] (shortcodes (searchEmojis "HEART" 48))
            , test "matches hyphenated skin-tone style text only when it is an inert keyword" <|
                \_ ->
                    Expect.equal [] (searchEmojis "skin-tone-2" 48)
            , test "matches keyword fragments when the shortcode does not match" <|
                \_ ->
                    Expect.equal [ "paperclip" ] (shortcodes (searchEmojis "attach" 48))
            , test "treats smile as a keyword lookup without inventing a smile shortcode" <|
                \_ ->
                    Expect.equal
                        [ ( "grinning", "😀" ), ( "blush", "😊" ), ( "sweat_smile", "😅" ) ]
                        (List.map (\entry -> ( entry.shortcode, entry.emoji )) (searchEmojis ":smile:" 3))
            , test "finds entries that publish ZWJ-related keywords only through ordinary keyword matching" <|
                \_ ->
                    Expect.equal [ "eyes" ] (shortcodes (searchEmojis "watch" 48))
            , test "returns an empty array for an unknown shortcode or keyword" <|
                \_ ->
                    Expect.equal [] (searchEmojis "missing_key" 48)
            , test "returns an empty array for literal unicode emoji queries" <|
                \_ ->
                    Expect.equal [] (searchEmojis "🚀" 48)
            , test "treats hostile markup-shaped text as an ordinary unmatched query" <|
                \_ ->
                    Expect.equal [] (searchEmojis ":<img src=x onerror=alert(1)>:" 48)
            ]
        ]
