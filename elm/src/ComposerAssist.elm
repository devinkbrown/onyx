module ComposerAssist exposing
    ( Assist
    , CommandLike
    , Inputs
    , Intent(..)
    , Key
    , Menu(..)
    , NickToken
    , Outcome
    , applyIntent
    , applyNickCompletion
    , closeEmoji
    , completeSlashCommand
    , cycleNickCompletion
    , initial
    , insertEmoji
    , isNickChar
    , keyIntent
    , menuFor
    , nickTokenAt
    , onInput
    , rankNickCompletions
    , setEmojiQuery
    , slashCommandQuery
    , slashSuggestions
    , toggleEmoji
    )

{-| Composer assist: slash-command suggestions, nick completion and
the emoji picker state (mirroring `src/lib/commands/registry.ts`
`slashCommandQuery` / `getSlashCommandSuggestions` /
`completeSlashCommand`, `src/lib/composer/nickComplete.ts`, and the
`shell/Composer.tsx` keyboard arms for the suggestion lists).

Pure: no `App` import (App's `Model` holds an `Assist`), so the
command registry is taken as any record carrying the fields the
suggestion layer reads.

Narrowing: this module does not track the caret (`GapConvo` does, for
emoji), so nick completion runs with the caret at the end of the draft.

-}


{-| What the suggestion layer reads from a registry entry. Only
text-kind entries carry `insertText` in the registry, so its
presence stands in for the oracle's `kind === 'text'` check.
-}
type alias CommandLike a =
    { a
        | name : String
        , aliases : List String
        , oper : Bool
        , insertText : Maybe String
    }


{-| Composer-local assist state (the oracle's `slashDismissed`,
`slashIndex`, `nickDismissed`, `nickIndex`, the Tab-cycle
bookkeeping, and the emoji dialog signals).
-}
type alias Assist =
    { slashDismissed : Bool
    , slashIndex : Int
    , nickDismissed : Bool
    , nickIndex : Int
    , nickCycle : Maybe { query : String, index : Int }
    , emojiOpen : Bool
    , emojiQuery : String
    }


initial : Assist
initial =
    { slashDismissed = False
    , slashIndex = 0
    , nickDismissed = False
    , nickIndex = 0
    , nickCycle = Nothing
    , emojiOpen = False
    , emojiQuery = ""
    }


{-| Typing re-arms both lists and resets the highlighted row
(mirroring `handleInput` clearing the dismissals and the
matches-changed effects resetting the indices).
-}
onInput : Assist -> Assist
onInput assist =
    { assist | slashDismissed = False, nickDismissed = False, slashIndex = 0, nickIndex = 0 }



-- SLASH COMMANDS


isJsSpace : Char -> Bool
isJsSpace c =
    List.member c [ ' ', '\t', '\n', '\u{000D}', '\u{000C}', '\u{000B}', '\u{00A0}', '\u{FEFF}', '\u{2028}', '\u{2029}', '\u{3000}', '\u{1680}', '\u{202F}', '\u{205F}' ]
        || (Char.toCode c >= 0x2000 && Char.toCode c <= 0x200A)


{-| The command query being typed (mirroring `slashCommandQuery`:
only a leading single `/`; the first token lowercased; `Nothing`
once whitespace follows the token).
-}
slashCommandQuery : String -> Maybe String
slashCommandQuery text =
    if not (String.startsWith "/" text) || String.startsWith "//" text then
        Nothing

    else
        let
            rest =
                String.toList (String.dropLeft 1 text)

            token =
                takeWhile (not << isJsSpace) rest
        in
        if List.isEmpty token then
            Just ""

        else if List.length rest > List.length token then
            Nothing

        else
            Just (String.toLower (String.fromList token))


takeWhile : (a -> Bool) -> List a -> List a
takeWhile keep list =
    case list of
        x :: xs ->
            if keep x then
                x :: takeWhile keep xs

            else
                []

        [] ->
            []


dropWhile : (a -> Bool) -> List a -> List a
dropWhile drop list =
    case list of
        x :: xs ->
            if drop x then
                dropWhile drop xs

            else
                list

        [] ->
            []


{-| Suggestions for the draft (mirroring `getSlashCommandSuggestions`:
name or alias prefix, registry order, oper verbs hidden unless the
session holds oper).
-}
slashSuggestions : String -> Int -> Bool -> List (CommandLike a) -> List (CommandLike a)
slashSuggestions text limit isOper commands =
    case slashCommandQuery text of
        Nothing ->
            []

        Just query ->
            commands
                |> List.filter
                    (\command ->
                        not (command.oper && not isOper)
                            && (String.startsWith query command.name
                                    || List.any (String.startsWith query) command.aliases
                               )
                    )
                |> List.take limit


{-| Accept a command into the draft (mirroring `completeSlashCommand`:
text conveniences expand in place; verbs complete with a trailing
argument space unless arguments already follow).
-}
completeSlashCommand : String -> CommandLike a -> String
completeSlashCommand input command =
    let
        rest =
            if String.startsWith "/" input then
                String.dropLeft 1 input
                    |> String.toList
                    |> dropWhile (not << isJsSpace)
                    |> dropWhile isJsSpace
                    |> String.fromList

            else
                String.fromList (dropWhile isJsSpace (String.toList input))
    in
    case command.insertText of
        Just insert ->
            if String.isEmpty rest then
                insert

            else
                insert ++ " " ++ rest

        Nothing ->
            "/" ++ command.name ++ " " ++ rest



-- NICK COMPLETION


type alias NickToken =
    { start : Int
    , end : Int
    , at : Bool
    , query : String
    }


{-| IRC nick characters (mirroring `isNickChar`: ASCII alnum plus
the RFC 2812 specials).
-}
isNickChar : Char -> Bool
isNickChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || List.member c [ '-', '[', ']', ',', '\\', '`', '^', '{', '}', '|', '_' ]


charAt : Int -> String -> Maybe Char
charAt i text =
    String.slice i (i + 1) text |> String.uncons |> Maybe.map Tuple.first


nickAt : Int -> String -> Bool
nickAt i text =
    Maybe.withDefault False (Maybe.map isNickChar (charAt i text))


{-| The incomplete nick token at the caret (mirroring `nickTokenAt`:
optional leading `@`, a word boundary before it, and slash input
yielding to command completion).
-}
nickTokenAt : String -> Int -> Maybe NickToken
nickTokenAt text caret =
    let
        len =
            String.length text

        slashOwned =
            String.startsWith "/" text
                && not (List.any isJsSpace (String.toList (String.slice 1 (max 1 caret) text)))

        forward i =
            if i < len && nickAt i text then
                forward (i + 1)

            else
                i

        back i =
            if i > 0 && nickAt (i - 1) text then
                back (i - 1)

            else
                i
    in
    if caret < 0 || caret > len || slashOwned then
        Nothing

    else
        let
            end =
                forward caret

            bare =
                back end
        in
        if bare == end then
            Nothing

        else
            let
                at =
                    bare > 0 && charAt (bare - 1) text == Just '@'

                start =
                    if at then
                        bare - 1

                    else
                        bare

                boundaryOk =
                    case charAt (start - 1) text of
                        Just prev ->
                            start == 0 || (not (isNickChar prev) && prev /= '@')

                        Nothing ->
                            True
            in
            if boundaryOk then
                Just { start = start, end = end, at = at, query = String.slice bare end text }

            else
                Nothing


{-| Rank candidates (mirroring `rankNickCompletions`: case-insensitive
prefix, de-duplicated case-insensitively; case-sensitive prefix
first, then shorter, then a locale-style compare — case-folded with
lowercase ahead of uppercase).
-}
rankNickCompletions : String -> List String -> Int -> List String
rankNickCompletions query nicks limit =
    let
        q =
            String.toLower query

        collect nick ( seen, hits ) =
            let
                lower =
                    String.toLower nick
            in
            if String.isEmpty nick || List.member lower seen then
                ( seen, hits )

            else if String.isEmpty q || String.startsWith q lower then
                ( lower :: seen, nick :: hits )

            else
                ( seen, hits )

        pref nick =
            if String.startsWith query nick then
                0

            else
                1

        order a b =
            case compare (pref a) (pref b) of
                EQ ->
                    case compare (String.length a) (String.length b) of
                        EQ ->
                            case compare (String.toLower a) (String.toLower b) of
                                EQ ->
                                    compare b a

                                other ->
                                    other

                        other ->
                            other

                other ->
                    other
    in
    List.foldl collect ( [], [] ) nicks
        |> Tuple.second
        |> List.reverse
        |> List.sortWith order
        |> List.take (max 1 limit)


{-| Splice the chosen nick over the token (mirroring
`applyNickCompletion`: the `@` kept, a trailing space added).
-}
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
    in
    { text = String.left token.start text ++ insert ++ String.dropLeft token.end text
    , caret = token.start + String.length insert
    }


{-| Tab-cycle (mirroring `cycleNickCompletion`: the first Tab takes
the best match, a repeated Tab advances through the ranked list).
-}
cycleNickCompletion : String -> Int -> List String -> Int -> Maybe { text : String, caret : Int, index : Int, matches : List String }
cycleNickCompletion text caret nicks previousIndex =
    nickTokenAt text caret
        |> Maybe.andThen
            (\token ->
                let
                    matches =
                        rankNickCompletions token.query nicks 8

                    index =
                        if previousIndex < 0 then
                            0

                        else
                            modBy (max 1 (List.length matches)) (previousIndex + 1)
                in
                List.head (List.drop index matches)
                    |> Maybe.map
                        (\nick ->
                            let
                                applied =
                                    applyNickCompletion text token nick
                            in
                            { text = applied.text, caret = applied.caret, index = index, matches = matches }
                        )
            )



-- MENUS AND KEYS


type alias Inputs a =
    { draft : String
    , isOper : Bool
    , nicks : List String
    , commands : List (CommandLike a)
    }


{-| The open suggestion list, if any (mirroring `slashVisible` and
`nickVisible`: slash wins; the nick list needs `@` or one typed
character and is suppressed while the slash list shows).
-}
type Menu a
    = SlashMenu (List (CommandLike a))
    | NickMenu NickToken (List String)
    | NoMenu


menuFor : Inputs a -> Assist -> Menu a
menuFor inputs assist =
    let
        slash =
            slashSuggestions inputs.draft 8 inputs.isOper inputs.commands
    in
    if not assist.slashDismissed && not (List.isEmpty slash) then
        SlashMenu slash

    else
        case nickTokenAt inputs.draft (String.length inputs.draft) of
            Just token ->
                let
                    matches =
                        if not token.at && String.isEmpty token.query then
                            []

                        else
                            rankNickCompletions token.query inputs.nicks 8
                in
                if assist.nickDismissed || List.isEmpty matches then
                    NoMenu

                else
                    NickMenu token matches

            Nothing ->
                NoMenu


type alias Key =
    { key : String
    , shift : Bool
    , alt : Bool
    , ctrl : Bool
    , meta : Bool
    }


{-| What a composer keystroke (or a list click) means to the assist
layer.
-}
type Intent
    = MenuMove Int
    | MenuAccept
    | MenuPick Int
    | MenuHover Int
    | MenuDismiss
    | NickCycle


{-| Classify a keydown (mirroring `handleKeyDown`'s list arms: arrows
move, Tab/Enter accept, Escape dismisses while a list is open; with
no list, a bare Tab cycles nick completion when it would complete
something). `Nothing` leaves the key to the browser and the other
composer handlers, so callers preventDefault only on `Just`.
-}
keyIntent : Inputs a -> Assist -> Key -> Maybe Intent
keyIntent inputs assist key =
    case menuFor inputs assist of
        NoMenu ->
            if key.key == "Tab" && not key.shift && not key.alt && not key.ctrl && not key.meta then
                cycleNickCompletion inputs.draft (String.length inputs.draft) inputs.nicks (cyclePrevious inputs assist)
                    |> Maybe.map (\_ -> NickCycle)

            else
                Nothing

        _ ->
            case key.key of
                "ArrowDown" ->
                    Just (MenuMove 1)

                "ArrowUp" ->
                    Just (MenuMove -1)

                "Tab" ->
                    Just MenuAccept

                "Enter" ->
                    Just MenuAccept

                "Escape" ->
                    Just MenuDismiss

                _ ->
                    Nothing


tokenQuery : Inputs a -> String
tokenQuery inputs =
    nickTokenAt inputs.draft (String.length inputs.draft)
        |> Maybe.map .query
        |> Maybe.withDefault ""


cyclePrevious : Inputs a -> Assist -> Int
cyclePrevious inputs assist =
    case assist.nickCycle of
        Just cycle ->
            if cycle.query == tokenQuery inputs then
                cycle.index

            else
                -1

        Nothing ->
            -1


type alias Outcome =
    { assist : Assist
    , draft : Maybe String
    }


{-| Apply an intent; `draft` is the replacement draft when one is
written (mirroring `completeCommand`, `completeNick`, and the Tab
cycle arm). Intents that do not fit the open list are no-ops.
-}
applyIntent : Inputs a -> Intent -> Assist -> Outcome
applyIntent inputs intent assist =
    let
        unchanged =
            { assist = assist, draft = Nothing }
    in
    case ( intent, menuFor inputs assist ) of
        ( MenuMove delta, SlashMenu commands ) ->
            { unchanged | assist = { assist | slashIndex = modBy (max 1 (List.length commands)) (assist.slashIndex + delta) } }

        ( MenuMove delta, NickMenu _ matches ) ->
            { unchanged | assist = { assist | nickIndex = modBy (max 1 (List.length matches)) (assist.nickIndex + delta) } }

        ( MenuHover index, SlashMenu _ ) ->
            { unchanged | assist = { assist | slashIndex = index } }

        ( MenuHover index, NickMenu _ _ ) ->
            { unchanged | assist = { assist | nickIndex = index } }

        ( MenuAccept, SlashMenu commands ) ->
            acceptSlash inputs assist commands assist.slashIndex

        ( MenuPick index, SlashMenu commands ) ->
            acceptSlash inputs assist commands index

        ( MenuAccept, NickMenu token matches ) ->
            acceptNick inputs assist token matches assist.nickIndex

        ( MenuPick index, NickMenu token matches ) ->
            acceptNick inputs assist token matches index

        ( MenuDismiss, SlashMenu _ ) ->
            { unchanged | assist = { assist | slashDismissed = True } }

        ( MenuDismiss, NickMenu _ _ ) ->
            { unchanged | assist = { assist | nickDismissed = True } }

        ( NickCycle, NoMenu ) ->
            case cycleNickCompletion inputs.draft (String.length inputs.draft) inputs.nicks (cyclePrevious inputs assist) of
                Just result ->
                    { assist = { assist | nickCycle = Just { query = tokenQuery inputs, index = result.index }, nickIndex = result.index }
                    , draft = Just result.text
                    }

                Nothing ->
                    unchanged

        _ ->
            unchanged


pickAt : Int -> List a -> Maybe a
pickAt index list =
    case List.head (List.drop index list) of
        Just hit ->
            Just hit

        Nothing ->
            List.head list


acceptSlash : Inputs a -> Assist -> List (CommandLike a) -> Int -> Outcome
acceptSlash inputs assist commands index =
    case pickAt index commands of
        Just command ->
            { assist = { assist | slashDismissed = True }
            , draft = Just (completeSlashCommand inputs.draft command)
            }

        Nothing ->
            { assist = assist, draft = Nothing }


acceptNick : Inputs a -> Assist -> NickToken -> List String -> Int -> Outcome
acceptNick inputs assist token matches index =
    case pickAt index matches of
        Just nick ->
            { assist = { assist | nickDismissed = True, nickCycle = Nothing }
            , draft = Just (applyNickCompletion inputs.draft token nick).text
            }

        Nothing ->
            { assist = assist, draft = Nothing }



-- EMOJI


toggleEmoji : Assist -> Assist
toggleEmoji assist =
    { assist | emojiOpen = not assist.emojiOpen }


closeEmoji : Assist -> Assist
closeEmoji assist =
    { assist | emojiOpen = False }


setEmojiQuery : String -> Assist -> Assist
setEmojiQuery query assist =
    { assist | emojiQuery = query }


{-| Insert a glyph and close the picker (mirroring
`insertTextAtCaret` with the caret at the end of the draft).
-}
insertEmoji : String -> String -> Assist -> { draft : String, assist : Assist }
insertEmoji glyph draft assist =
    { draft = draft ++ glyph, assist = closeEmoji assist }
