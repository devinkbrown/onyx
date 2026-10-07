module ComposerInject exposing
    ( InjectMode(..)
    , formatMentionInsert
    , formatQuoteInsert
    , maxQuoteBody
    , mergeComposerInsert
    , sanitizeComposerFragment
    )

{-| Quote / mention composer inserts — Elm port of the pure surface in
`src/lib/composer/composerInject.ts`: plaintext formatting plus the
draft merge (caret included). Applying the merge to the store draft
and moving DOM focus stay with the caller.
-}


{-| Insert merge mode (mirrors `ComposerInjectMode`). -}
type InjectMode
    = InjectAppend
    | InjectPrefix
    | InjectReplace


{-| Free-text bound for quote fragments (mirrors `MAX_QUOTE_BODY`;
JS slices UTF-16 units, Elm counts chars, so astral text may differ
by a surrogate half at the cap). -}
maxQuoteBody : Int
maxQuoteBody =
    400


isStrippedControl : Char -> Bool
isStrippedControl c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x00 && code <= 0x08)
        || code == 0x0B
        || code == 0x0C
        || (code >= 0x0E && code <= 0x1F)
        || code == 0x7F


isBoundarySpace : Char -> Bool
isBoundarySpace c =
    Char.toCode c <= 0x20


{-| Collapse whitespace and strip control characters from free text
(mirrors `sanitizeComposerFragment`). -}
sanitizeComposerFragment : String -> Int -> String
sanitizeComposerFragment raw maxLen =
    raw
        |> String.toList
        |> List.filter (not << isStrippedControl)
        |> String.fromList
        |> String.replace "\u{000D}\n" "\n"
        |> String.replace "\u{000D}" "\n"
        |> String.trim
        |> String.left maxLen


{-| IRC-style quote: leading `> ` lines plus a blank line for a reply
(mirrors `formatQuoteInsert`). Empty body yields an
attribution-only stub. -}
formatQuoteInsert : String -> String -> String
formatQuoteInsert from body =
    let
        nick =
            case sanitizeComposerFragment from 64 of
                "" ->
                    "someone"

                clean ->
                    clean

        text =
            sanitizeComposerFragment body maxQuoteBody
    in
    if String.isEmpty text then
        "> (" ++ nick ++ ")\n\n"

    else
        text
            |> String.split "\n"
            |> List.map (\line -> "> " ++ line)
            |> String.join "\n"
            |> (\quoted -> quoted ++ "\n\n")


{-| Leading @mention with trailing space for continued typing
(mirrors `formatMentionInsert`). -}
formatMentionInsert : String -> String
formatMentionInsert nick =
    case sanitizeComposerFragment nick 64 of
        "" ->
            ""

        clean ->
            "@" ++ clean ++ " "


{-| Merge an insert into current draft text (mirrors
`mergeComposerInsert`). -}
mergeComposerInsert : String -> String -> InjectMode -> { text : String, caret : Int }
mergeComposerInsert current insert mode =
    if String.isEmpty insert then
        { text = current, caret = String.length current }

    else
        case mode of
            InjectReplace ->
                { text = insert, caret = String.length insert }

            InjectPrefix ->
                if String.isEmpty current then
                    { text = insert, caret = String.length insert }

                else
                    { text = insert ++ current, caret = String.length insert }

            InjectAppend ->
                if String.isEmpty current then
                    { text = insert, caret = String.length insert }

                else
                    let
                        endsSpace =
                            String.right 1 current
                                |> String.toList
                                |> List.head
                                |> Maybe.map isBoundarySpace
                                |> Maybe.withDefault False

                        startsSpace =
                            String.left 1 insert
                                |> String.toList
                                |> List.head
                                |> Maybe.map isBoundarySpace
                                |> Maybe.withDefault False

                        next =
                            if not endsSpace && not startsSpace && not (String.startsWith "\n" insert) then
                                current ++ " " ++ insert

                            else
                                current ++ insert
                    in
                    { text = next, caret = String.length next }
