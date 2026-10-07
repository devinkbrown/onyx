module MessageMenu exposing
    ( Capabilities
    , CapabilityInput
    , capabilities
    , loadedActionText
    , suggestSearchQuery
    , suggestTopicLabel
    )

{-| Per-message action gating — Elm port of the pure surface in
`src/shell/message/MessageMenu.tsx` (`messageMenuCapabilities`,
`loadedMessageActionText`, `suggestTopicLabelFromMessage`,
`suggestSearchQueryFromMessage`): which hover-bar / overflow-menu
items apply to a row, which text those items may act on, and the
compact phrases for topic-start and message search. The popover UI,
translation engine, and clipboard bridges stay host-side.
-}

import App
import DmCipher
import GroupEnvelope
import Regex


{-| Which menu items apply to a message (mirrors
`MessageMenuCapabilities`). -}
type alias Capabilities =
    { canReply : Bool
    , canReact : Bool
    , canCopy : Bool
    , canSearchText : Bool
    , canCopyMoment : Bool
    , canStartTopic : Bool
    , canEdit : Bool
    , canDelete : Bool
    , canIgnore : Bool
    , canQuote : Bool
    , canCollapse : Bool
    }


{-| Capability inputs (mirrors `CapabilityInput`). -}
type alias CapabilityInput =
    { msg : App.ChatMessage
    , selfNick : String
    , editingEnabled : Bool
    , deleteSupported : Bool
    , channelTarget : Bool
    }


{-| True for an envelope-shaped body even when a legacy row omitted
the flag (mirrors `hasEncryptedMessageBoundary`). -}
isEncryptedRow : App.ChatMessage -> Bool
isEncryptedRow msg =
    DmCipher.isEnvelope msg.body || GroupEnvelope.isGroupEnvelope msg.body


{-| Only text already readable in a loaded row (mirrors
`loadedMessageActionText`): deleted/redacted rows yield nothing,
envelope rows yield transient plaintext exclusively — a locked row's
ciphertext is never action text — and blank text yields nothing. -}
loadedActionText : App.ChatMessage -> Maybe String
loadedActionText msg =
    if msg.deleted || msg.redacted then
        Nothing

    else
        let
            source =
                if isEncryptedRow msg then
                    msg.plaintext

                else
                    Just msg.body
        in
        case source of
            Nothing ->
                Nothing

            Just text ->
                if String.isEmpty (String.trim text) then
                    Nothing

                else
                    Just text


{-| Derive which menu items apply to a message (mirrors
`messageMenuCapabilities`). -}
capabilities : CapabilityInput -> Capabilities
capabilities input =
    let
        msg =
            input.msg

        gone =
            msg.deleted || msg.redacted

        isOwn =
            not (String.isEmpty input.selfNick)
                && String.toLower msg.from == String.toLower input.selfNick

        hasText =
            loadedActionText msg /= Nothing

        hasFrom =
            not (String.isEmpty (String.trim msg.from))
    in
    { canReply = not gone
    , canReact = not gone
    , canCopy = hasText
    , canSearchText = hasText
    , canCopyMoment = not gone && input.channelTarget
    , canStartTopic = not gone && input.channelTarget && hasText
    , canEdit =
        not gone
            && isOwn
            && input.editingEnabled
            && msg.msgType == "msg"
            && not (isEncryptedRow msg)
    , canDelete = not gone && not msg.pending && isOwn && input.deleteSupported
    , canIgnore = not gone && not isOwn && hasFrom
    , canQuote = hasText
    , canCollapse = not gone && not isOwn && hasFrom
    }


linkPattern : Regex.Regex
linkPattern =
    Maybe.withDefault Regex.never
        (Regex.fromStringWith { caseInsensitive = True, multiline = False } "https?://\\S+")


markdownPattern : Regex.Regex
markdownPattern =
    Maybe.withDefault Regex.never
        (Regex.fromString "[`*_~>#[\\]()+={}]")


spacePattern : Regex.Regex
spacePattern =
    Maybe.withDefault Regex.never
        (Regex.fromString "\\s+")


trailingPunctPattern : Regex.Regex
trailingPunctPattern =
    Maybe.withDefault Regex.never
        (Regex.fromString "[,:;.!?]+$")


{-| Strip links + markdown to a trimmed single-spaced phrase (mirrors
the shared `suggest*` normalization). -}
plainPhrase : String -> String
plainPhrase text =
    text
        |> Regex.replace linkPattern (\_ -> "")
        |> Regex.replace markdownPattern (\_ -> " ")
        |> Regex.replace spacePattern (\_ -> " ")
        |> String.trim


{-| First valid topic label from a message (mirrors
`suggestTopicLabelFromMessage`): the first six words, shrinking until
`isValidTopicLabel` passes. -}
suggestTopicLabel : String -> Maybe String
suggestTopicLabel text =
    let
        words =
            plainPhrase text
                |> String.split " "
                |> List.filter (not << String.isEmpty)
                |> List.take 6
    in
    shrinkLabel words


shrinkLabel : List String -> Maybe String
shrinkLabel words =
    case words of
        [] ->
            Nothing

        _ ->
            let
                candidate =
                    words
                        |> String.join " "
                        |> Regex.replace trailingPunctPattern (\_ -> "")
                        |> String.trim
            in
            if App.isValidTopicLabel candidate then
                Just candidate

            else
                shrinkLabel (List.take (List.length words - 1) words)


{-| Compact search phrase from message text (mirrors
`suggestSearchQueryFromMessage`): the first eight words, trailing
punctuation trimmed. -}
suggestSearchQuery : String -> Maybe String
suggestSearchQuery text =
    let
        candidate =
            plainPhrase text
                |> String.split " "
                |> List.filter (not << String.isEmpty)
                |> List.take 8
                |> String.join " "
                |> Regex.replace trailingPunctPattern (\_ -> "")
                |> String.trim
    in
    if String.isEmpty candidate then
        Nothing

    else
        Just candidate
