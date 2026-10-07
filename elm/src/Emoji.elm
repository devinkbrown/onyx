module Emoji exposing
    ( EmojiEntry
    , emojiList
    , searchEmojis
    )

{-| Emoji search (mirroring `src/lib/emoji/emoji.ts`: the curated
reaction set plus shortcode/keyword search for the reaction
picker). -}


{-| One reaction entry: the unicode glyph, its shortcode, and
latin search keywords. -}
type alias EmojiEntry =
    { emoji : String
    , shortcode : String
    , keywords : List String
    }


{-| The curated reaction set. -}
emojiList : List EmojiEntry
emojiList =
    [ { emoji = "😀", shortcode = "grinning", keywords = [ "smile", "happy" ] }
    , { emoji = "😂", shortcode = "joy", keywords = [ "laugh", "lol" ] }
    , { emoji = "😊", shortcode = "blush", keywords = [ "smile", "warm" ] }
    , { emoji = "😍", shortcode = "heart_eyes", keywords = [ "love", "crush" ] }
    , { emoji = "😎", shortcode = "sunglasses", keywords = [ "cool" ] }
    , { emoji = "😭", shortcode = "sob", keywords = [ "cry", "sad" ] }
    , { emoji = "😅", shortcode = "sweat_smile", keywords = [ "nervous", "relief" ] }
    , { emoji = "👍", shortcode = "thumbsup", keywords = [ "approve", "yes" ] }
    , { emoji = "👎", shortcode = "thumbsdown", keywords = [ "no", "disapprove" ] }
    , { emoji = "🙏", shortcode = "pray", keywords = [ "thanks", "please" ] }
    , { emoji = "👏", shortcode = "clap", keywords = [ "applause" ] }
    , { emoji = "🔥", shortcode = "fire", keywords = [ "lit", "hot" ] }
    , { emoji = "✨", shortcode = "sparkles", keywords = [ "magic", "shine" ] }
    , { emoji = "🎉", shortcode = "tada", keywords = [ "party", "celebrate" ] }
    , { emoji = "❤️", shortcode = "heart", keywords = [ "love" ] }
    , { emoji = "💙", shortcode = "blue_heart", keywords = [ "love", "ocean" ] }
    , { emoji = "💡", shortcode = "bulb", keywords = [ "idea" ] }
    , { emoji = "✅", shortcode = "white_check_mark", keywords = [ "done", "ok" ] }
    , { emoji = "❌", shortcode = "x", keywords = [ "cancel", "no" ] }
    , { emoji = "⚠️", shortcode = "warning", keywords = [ "alert" ] }
    , { emoji = "📎", shortcode = "paperclip", keywords = [ "attachment", "file" ] }
    , { emoji = "🧵", shortcode = "thread", keywords = [ "reply" ] }
    , { emoji = "🌊", shortcode = "ocean", keywords = [ "wave", "water" ] }
    , { emoji = "🌙", shortcode = "moon", keywords = [ "night" ] }
    , { emoji = "🚀", shortcode = "rocket", keywords = [ "ship", "launch" ] }
    , { emoji = "👀", shortcode = "eyes", keywords = [ "look", "watch" ] }
    , { emoji = "💬", shortcode = "speech_balloon", keywords = [ "chat" ] }
    , { emoji = "🫡", shortcode = "saluting_face", keywords = [ "salute", "roger" ] }
    ]


{-| Search the curated set by shortcode or keyword fragment
(case-insensitive; one surrounding colon pair stripped; empty
queries return the leading entries up to the limit). -}
searchEmojis : String -> Int -> List EmojiEntry
searchEmojis query limit =
    let
        needle =
            String.trim query
                |> stripOneLeadingColon
                |> stripOneTrailingColon
                |> String.toLower
    in
    if String.isEmpty needle then
        List.take limit emojiList

    else
        List.filter
            (\entry ->
                String.contains needle entry.shortcode
                    || List.any (String.contains needle) entry.keywords
            )
            emojiList
            |> List.take limit


stripOneLeadingColon : String -> String
stripOneLeadingColon value =
    if String.startsWith ":" value then
        String.dropLeft 1 value

    else
        value


stripOneTrailingColon : String -> String
stripOneTrailingColon value =
    if String.endsWith ":" value then
        String.dropRight 1 value

    else
        value
