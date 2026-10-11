module View.MessageText exposing (messageText)

{-| Rich message body, mirroring `shell/message/MessageText.tsx`: renders
`MessageText` tokens as safe nodes only.

  - Links go live only through the `isHttpUrl` sink gate, open in a new
    tab with `noopener noreferrer`; anything else renders as inert text.
  - Mentions tint, with the self mention marked.
  - Channel names are buttons that jump to (or join) the room.
  - Spoilers are a native disclosure (`details`), so reveal needs no
    model state and stays keyboard-operable.
  - mIRC runs carry palette/hex-validated inline colours only.
-}

import App exposing (Msg(..))
import Emoji
import Html exposing (Html, a, blockquote, br, code, details, em, pre, s, span, strong, summary, text)
import Html.Attributes exposing (attribute, class, href, rel, style, target, type_)
import Html.Events exposing (onClick)
import MessageText exposing (InlineToken(..), Token(..))


messageText : String -> String -> Html Msg
messageText selfNick raw =
    span [ class "shell-msg-text" ] (List.concatMap (renderToken selfNick) (tidyBlocks False (MessageText.parseMessage raw)))


{-| v3/rx-convo — a code block or quote already sits on its own lines,
so the line break that separated it from the neighbouring text would
paint an empty line (`> quote\nreply` drew a blank line under the
quote). Drop one leading newline from the text right after a block
and one trailing newline from the text right before one.
-}
tidyBlocks : Bool -> List Token -> List Token
tidyBlocks afterBlock tokens =
    case tokens of
        [] ->
            []

        tok :: rest ->
            case tok of
                Inline (Text t) ->
                    let
                        beforeBlock =
                            case rest of
                                (Inline _) :: _ ->
                                    False

                                [] ->
                                    False

                                _ ->
                                    True

                        lead =
                            if afterBlock && String.startsWith "\n" t then
                                String.dropLeft 1 t

                            else
                                t

                        tidy =
                            if beforeBlock && String.endsWith "\n" lead then
                                String.dropRight 1 lead

                            else
                                lead
                    in
                    if String.isEmpty tidy then
                        tidyBlocks afterBlock rest

                    else
                        Inline (Text tidy) :: tidyBlocks False rest

                Inline _ ->
                    tok :: tidyBlocks False rest

                _ ->
                    tok :: tidyBlocks True rest


renderToken : String -> Token -> List (Html Msg)
renderToken selfNick token =
    case token of
        Inline t ->
            renderInline selfNick t

        CodeBlock cb ->
            [ pre [ class "shell-msg-codeblock" ]
                ((if String.isEmpty cb.lang then
                    []

                  else
                    [ span [ class "shell-msg-codeblock-lang", attribute "aria-hidden" "true" ] [ text cb.lang ] ]
                 )
                    ++ [ code [] [ text cb.text ] ]
                )
            ]

        Blockquote children ->
            [ blockquote [ class "shell-msg-blockquote" ] (List.concatMap (renderInline selfNick) children) ]


renderInline : String -> InlineToken -> List (Html Msg)
renderInline selfNick token =
    let
        children =
            List.concatMap (renderInline selfNick)
    in
    case token of
        Text t ->
            String.split "\n" t
                |> List.map text
                |> List.intersperse (br [] [])

        Code t ->
            [ code [] [ text t ] ]

        Bold c ->
            [ strong [] (children c) ]

        Italic c ->
            [ em [] (children c) ]

        Strike c ->
            [ s [] (children c) ]

        Spoiler c ->
            [ details [ class "shell-msg-spoiler" ]
                (summary [ class "shell-msg-spoiler-label", attribute "aria-label" "Reveal spoiler" ] [ text "spoiler" ]
                    :: children c
                )
            ]

        Styled st c ->
            [ span (class "shell-msg-irc" :: List.map (\( k, v ) -> style k v) (MessageText.styleCss st)) (children c) ]

        Link l ->
            if MessageText.isHttpUrl l.href then
                [ a [ href l.href, target "_blank", rel "noopener noreferrer", class "shell-msg-link" ] [ text l.text ] ]

            else
                [ span [ class "shell-msg-link" ] [ text l.text ] ]

        Mention nick ->
            let
                isSelf =
                    not (String.isEmpty selfNick) && String.toLower nick == String.toLower selfNick
            in
            [ span
                [ class
                    (if isSelf then
                        "shell-msg-mention shell-msg-mention--self"

                     else
                        "shell-msg-mention"
                    )
                ]
                [ text ("@" ++ nick) ]
            ]

        Channel name ->
            [ Html.button
                [ type_ "button"
                , class "shell-msg-channel-link"
                , attribute "aria-label" ("Jump to " ++ name)
                , onClick (ChannelLinkClicked name)
                ]
                [ text name ]
            ]

        Emoji shortcode ->
            case List.filter (\e -> e.shortcode == shortcode) Emoji.emojiList of
                entry :: _ ->
                    [ span [ class "shell-msg-emoji", attribute "role" "img", attribute "aria-label" shortcode ] [ text entry.emoji ] ]

                [] ->
                    [ text (":" ++ shortcode ++ ":") ]
