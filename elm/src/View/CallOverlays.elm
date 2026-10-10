module View.CallOverlays exposing
    ( captionsButton
    , captionsOverlay
    , handButton
    , moreReactItem
    , reactButton
    , reactMenu
    , reactionChips
    , settingsItem
    )

{-| v3/calls-c8 — C8 live captions + reactions overlay
(`CALLS_DESIGN.md` §2.4, §2.10, §3.3, §3.4; oracle
`overlays/CaptionsOverlay.tsx`, `overlays/ReactionsOverlay.tsx` and
the VoiceBar engagement group).

  - Captions: `section aria-label="Live captions"` docked above the
    bar (in flow, so it can never cover a control), last 3 lines on a
    94%-opaque `--onyx-bg` plate; the `role="log"` region holds only
    the lines (the toolbar stays out of the announced feed).
  - Reactions: the React menu is `role="menu"` with a roving tab stop
    (arrows wrap, Home/End); chips are `aria-hidden`, bottom-right of
    the stage, 2600ms, max 3, no motion under reduced motion.
  - Hand: `aria-pressed` toggle with the warn fill when raised.

Narrowing: the oracle's always-on "On-device caption translation is
unavailable in this browser." note is dropped — without a translator
the per-line Translate button simply does not render.

-}

import App exposing (Model, Msg(..), TranslationStatus(..))
import CallCaptions
import Dict
import Html exposing (Html, button, div, p, section, span, text)
import Html.Attributes exposing (attribute, class, disabled, id, tabindex, title, type_)
import Html.Events exposing (onClick, preventDefaultOn)
import Json.Decode as Decode
import Media
import Translate
import View.CallPresence exposing (callIcon)
import VoiceSettings


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


inCall : Model -> Bool
inCall model =
    model.calls.lifecycle == Media.InCall


{-| Hand (§2.4): "Raise hand" / "Lower hand", caption "Hand". -}
handButton : Model -> Bool -> Html Msg
handButton model reconnecting =
    let
        raised =
            model.callOverlay.handRaised
    in
    button
        [ type_ "button"
        , class "onyx-cbtn onyx-cbtn-hand"
        , attribute "data-testid" "raise-hand-button"
        , attribute "aria-keyshortcuts" "Control+Shift+H Meta+Shift+H"
        , attribute "aria-pressed" (boolAttr raised)
        , attribute "aria-label" (CallCaptions.handLabel raised)
        , disabled (reconnecting || not (inCall model))
        , onClick CallToggleHand
        ]
        [ callIcon "hand", span [ class "onyx-cbtn-cap" ] [ text "Hand" ] ]


reactAvailable : Model -> Bool
reactAvailable model =
    inCall model && model.calls.channel /= Nothing


{-| React (§2.4): opens the reaction menu. Hidden <768px (it moves
into More there).
-}
reactButton : Model -> Bool -> Html Msg
reactButton model reconnecting =
    button
        [ type_ "button"
        , class "onyx-cbtn onyx-cbtn-react"
        , attribute "data-testid" "reactions-button"
        , attribute "aria-label" "Send a reaction"
        , attribute "aria-haspopup" "menu"
        , attribute "aria-expanded" (boolAttr model.callOverlay.reactOpen)
        , title "Send a reaction"
        , disabled (reconnecting || not (reactAvailable model))
        , onClick CallReactToggle
        ]
        [ callIcon "react", span [ class "onyx-cbtn-cap" ] [ text "React" ] ]


{-| Captions toggle (§2.4): "Show live captions" / "Hide live captions". -}
captionsButton : Model -> Bool -> Html Msg
captionsButton model reconnecting =
    let
        on =
            model.callOverlay.captionsOn
    in
    button
        [ type_ "button"
        , class "onyx-cbtn"
        , attribute "data-testid" "captions-button"
        , attribute "aria-keyshortcuts" "Control+Shift+C Meta+Shift+C"
        , attribute "aria-pressed" (boolAttr on)
        , attribute "aria-label"
            (if on then
                "Hide live captions"

             else
                "Show live captions"
            )
        , disabled reconnecting
        , onClick CallToggleCaptions
        ]
        [ callIcon "cc", span [ class "onyx-cbtn-cap" ] [ text "Captions" ] ]


{-| The React entry inside More (<768px only, spec §2.4 mobile). -}
moreReactItem : Model -> Html Msg
moreReactItem model =
    div [ class "onyx-call-more-react" ]
        [ button
            [ type_ "button"
            , class "onyx-call-more-item"
            , attribute "data-testid" "call-more-react"
            , attribute "aria-haspopup" "menu"
            , disabled (not (reactAvailable model))
            , onClick CallReactToggle
            ]
            [ callIcon "react", text "Send a reaction" ]
        ]


{-| More → Settings, replacing the C2 stub (§2.4 / §2.11). -}
settingsItem : Html Msg
settingsItem =
    button
        [ type_ "button"
        , class "onyx-call-more-item"
        , attribute "aria-label" "Open voice settings"
        , attribute "aria-haspopup" "dialog"
        , attribute "data-testid" "call-more-settings"
        , onClick (VoiceSettingsMsg VoiceSettings.Open)
        ]
        [ callIcon "settings", text "Open voice settings" ]


rovingDecoder : Int -> Decode.Decoder ( Msg, Bool )
rovingDecoder index =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Escape" then
                    Decode.succeed ( CallReactClose, True )

                else
                    case CallCaptions.rovingIndex key index (List.length CallCaptions.quickReactions) of
                        Just next ->
                            Decode.succeed ( CallReactFocus next, True )

                        Nothing ->
                            Decode.fail "not ours"
            )


{-| The React menu (§2.10): 8 items, one tab stop. Mounted with a
`data-call-dialog` marker so the shared overlay focus helper moves
focus to the first item and returns it to the opener on close.
-}
reactMenu : Model -> Html Msg
reactMenu model =
    if not model.callOverlay.reactOpen then
        text ""

    else
        div
            [ class "onyx-call-react-menu"
            , attribute "role" "menu"
            , attribute "aria-label" "Send a reaction"
            , attribute "data-call-dialog" "react"
            , attribute "data-testid" "call-react-menu"
            ]
            (List.indexedMap
                (\i emoji ->
                    button
                        ([ type_ "button"
                         , class "onyx-call-react-item"
                         , id ("call-react-" ++ String.fromInt i)
                         , attribute "role" "menuitem"
                         , tabindex
                            (if i == model.callOverlay.reactIndex then
                                0

                             else
                                -1
                            )
                         , attribute "aria-label" (CallCaptions.reactionAria emoji)
                         , attribute "data-testid" ("reaction-" ++ emoji)
                         , preventDefaultOn "keydown" (rovingDecoder i)
                         , onClick (CallReact emoji)
                         ]
                            ++ (if i == model.callOverlay.reactIndex then
                                    [ attribute "data-initial-focus" "true" ]

                                else
                                    []
                               )
                        )
                        [ span [ attribute "aria-hidden" "true" ] [ text emoji ] ]
                )
                CallCaptions.quickReactions
            )


displayName : Model -> String -> String
displayName model key =
    if key == String.toLower model.ourNick then
        model.ourNick

    else
        model.calls.channel
            |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
            |> Maybe.andThen (\ch -> Dict.get key ch.members)
            |> Maybe.map .nick
            |> Maybe.withDefault key


initialOf : String -> String
initialOf name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


{-| Incoming reaction chips (§2.10): "{avatar} {nick} {glyph}
{verb}", aria-hidden, bottom-right of the stage, never over the bar.
-}
reactionChips : Model -> Html Msg
reactionChips model =
    let
        chips =
            CallCaptions.visibleChips (max model.nowMs model.callClockMs) model.callOverlay.chips
    in
    if List.isEmpty chips then
        text ""

    else
        div [ class "onyx-call-reactions", attribute "aria-hidden" "true", attribute "data-testid" "voice-reactions-overlay" ]
            [ div [ class "onyx-call-reactions-stack" ]
                (List.map
                (\chip ->
                    let
                        name =
                            displayName model chip.key
                    in
                    span [ class "onyx-call-reaction", attribute "data-chip" (String.fromInt chip.id) ]
                        ([ span [ class "onyx-call-avatar onyx-call-avatar-sm" ] [ text (initialOf name) ]
                         , span [ class "onyx-call-reaction-nick" ] [ text name ]
                         ]
                            ++ (case CallCaptions.chipVerb chip.emoji of
                                    Just verb ->
                                        [ callIcon "hand", span [ class "onyx-call-reaction-verb" ] [ text verb ] ]

                                    Nothing ->
                                        [ span [ class "onyx-call-reaction-emoji" ] [ text chip.emoji ] ]
                               )
                        )
                )
                chips
                )
            ]


{-| Live captions (§2.10). Mounted while captions are on so the log
region exists before the first line arrives; the plate is hidden
until there is something to read.
-}
captionsOverlay : Model -> Html Msg
captionsOverlay model =
    if not model.callOverlay.captionsOn || model.calls.lifecycle == Media.Idle then
        text ""

    else
        let
            lines =
                CallCaptions.captionLines
                    { captionsOn = True
                    , lifecycle = model.calls.lifecycle
                    , channel = model.calls.channel
                    , activeChannel = model.activeChannel
                    }
                    model.media

            count =
                List.length lines

            live =
                model.connection == App.Live

            copy =
                model.callOverlay.copy

            lang =
                Translate.resolveTranslationTarget model.translationTarget model.translationBrowserLang
        in
        section
            [ class "onyx-call-captions"
            , attribute "aria-label" "Live captions"
            , attribute "data-testid" "captions-overlay"
            , attribute "data-empty" (boolAttr (count == 0))
            ]
            [ div [ class "onyx-call-captions-head" ]
                [ span [ class "onyx-call-captions-title" ] [ text "Live captions" ]
                , span [ class "onyx-call-captions-source", attribute "data-live" (boolAttr live) ] [ text (CallCaptions.captionSource live) ]
                , button
                    [ type_ "button"
                    , class "onyx-call-captions-copy"
                    , attribute "aria-label" "Copy live caption transcript"
                    , attribute "data-testid" "captions-copy"
                    , attribute "aria-busy" (boolAttr (copy == CallCaptions.CopyBusy))
                    , disabled (copy == CallCaptions.CopyBusy)
                    , onClick CallCaptionsCopy
                    ]
                    [ text
                        (if copy == CallCaptions.CopyBusy then
                            "Copying…"

                         else
                            "Copy transcript"
                        )
                    ]
                , case CallCaptions.copyResultText copy of
                    Just result ->
                        span
                            [ class "onyx-call-captions-state"
                            , attribute "role"
                                (if copy == CallCaptions.CopyBlocked then
                                    "alert"

                                 else
                                    "status"
                                )
                            ]
                            [ text result ]

                    Nothing ->
                        text ""
                ]
            , div
                [ class "onyx-call-captions-log"
                , attribute "role" "log"
                , attribute "aria-live" "polite"
                , attribute "aria-label" "Live captions"
                , attribute "data-testid" "captions-log"
                ]
                (List.indexedMap (captionLine model lang count) lines)
            ]


captionLine : Model -> String -> Int -> Int -> CallCaptions.CaptionLine -> Html Msg
captionLine model lang count index line =
    let
        translation =
            Dict.get (CallCaptions.captionTranslationId line.key) model.translations

        status =
            Maybe.map .status translation

        langLabel =
            Translate.languageLabel lang
    in
    p
        [ class "onyx-call-caption"
        , attribute "data-old" (boolAttr (CallCaptions.lineOpacity index count < 1))
        ]
        ([ span [ class "onyx-call-caption-nick" ] [ text line.nick ]
         , span [ class "onyx-call-caption-text" ] [ text line.text ]
         ]
            ++ (if model.translationAvailable then
                    [ button
                        [ type_ "button"
                        , class "onyx-call-caption-translate"
                        , attribute "aria-label"
                            (if status == Just TranslationFailed then
                                "Retry translating " ++ line.nick ++ "'s caption to " ++ langLabel

                             else
                                "Translate " ++ line.nick ++ "'s caption to " ++ langLabel
                            )
                        , disabled (status == Just TranslationPending)
                        , onClick (CallCaptionTranslate line.key)
                        ]
                        [ text
                            (case status of
                                Just TranslationPending ->
                                    "Translating…"

                                Just TranslationFailed ->
                                    "Retry"

                                _ ->
                                    "Translate"
                            )
                        ]
                    ]

                else
                    []
               )
            ++ (case ( status, translation ) of
                    ( Just TranslationPending, _ ) ->
                        [ span [ class "onyx-call-caption-tr", attribute "role" "status", attribute "aria-live" "polite" ] [ text "Translating on this device…" ] ]

                    ( Just TranslationDone, Just entry ) ->
                        [ span [ class "onyx-call-caption-tr", attribute "data-lang" entry.lang ] [ text entry.text ] ]

                    ( Just TranslationFailed, _ ) ->
                        [ span [ class "onyx-call-caption-tr", attribute "role" "status", attribute "aria-live" "polite" ] [ text "On-device translation failed. Use Retry to try again." ] ]

                    _ ->
                        []
               )
        )
