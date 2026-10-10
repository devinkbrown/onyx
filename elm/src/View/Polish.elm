module View.Polish exposing
    ( addToHomeScreen
    , firstRunNotify
    , moreTools
    , scrubberToggle
    , timeScrubber
    , updateBanner
    )

{-| v3/polish views (state + folds live in `Polish` / `App`):

  - `moreTools` — the composer "More tools" disclosure (oracle
    `Composer.tsx`): Attach, Send later (the existing schedule popover),
    Jump to date, Emoji, the room ledger link, and the slash-command
    tip. A non-modal `role="dialog"` tray; Escape closes it and returns
    focus to the trigger.
  - `scrubberToggle` / `timeScrubber` — the room header More entry and
    the compact 24h UTC scrubber under the header (oracle
    `TimeScrubber.tsx`): roving-tabindex hour bars, a date jump, a
    moment-link copy, the room ledger link.
  - `firstRunNotify` / `addToHomeScreen` — the two quiet sheets on the
    shared `View.Sheet` primitive (both registered in
    `App.overlayStack`).
  - `updateBanner` — the update-available status strip.

-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, input, label, p, section, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, href, id, title, type_, value)
import Html.Events exposing (custom, onClick, onInput)
import Json.Decode as Decode
import Polish
import Schedule
import Stats
import View.Sheet as Sheet



-- COMPOSER MORE TOOLS


moreTools : Model -> Html Msg
moreTools model =
    let
        ready =
            model.activeChannel /= Nothing

        open =
            model.polish.toolsOpen
    in
    div [ class "shell-composer-more-wrap" ]
        (button
            ([ type_ "button"
             , id App.polishToolsTriggerId
             , class "shell-composer-tool shell-composer-tool--more"
             , attribute "data-composer-primary" "more"
             , attribute "data-testid" "composer-more-tools"
             , disabled (not ready)
             , attribute "aria-label" "More tools"
             , attribute "aria-haspopup" "dialog"
             , attribute "aria-expanded" (boolAttr open)
             , title "More tools"
             , onClick (PolishMsg Polish.ToolsToggle)
             ]
                ++ (if open then
                        [ attribute "aria-controls" "shell-composer-tools" ]

                    else
                        []
                   )
            )
            [ span [ class "shell-composer-action-label" ] [ text "More" ] ]
            :: (if open then
                    [ tray model ]

                else
                    []
               )
        )


tray : Model -> Html Msg
tray model =
    let
        gate =
            App.polishScheduleGate model

        refusal =
            Schedule.scheduleComposerRefusal gate

        protected =
            case model.activeChannel of
                Just target ->
                    App.dmDesignated model target

                Nothing ->
                    False

        room =
            App.polishScrubberRoom model
    in
    div
        [ id "shell-composer-tools"
        , class "shell-composer-tools"
        , attribute "role" "dialog"
        , attribute "aria-modal" "false"
        , attribute "aria-label" "More composer tools"
        , attribute "data-testid" "composer-tools-tray"
        , custom "keydown"
            (escapeKey
                |> Decode.map (\m -> { message = m, stopPropagation = True, preventDefault = True })
            )
        ]
        ([ item
            { testId = "composer-tools-attach"
            , label = "Attach files"
            , titleText = "Attach"
            , desc =
                if protected then
                    App.dmAttachmentBlocked

                else
                    "Up to 5 files, 25 MB each."
            , descId = "shell-composer-tools-attach-desc"
            , enabled = model.activeChannel /= Nothing && not protected
            , msg = Polish.ToolsAttach
            , extra = []
            }
         , item
            { testId = "composer-schedule"
            , label = "Schedule message to send later"
            , titleText = "Send later"
            , desc = Maybe.withDefault "Schedule this message for a time you pick." refusal
            , descId = "shell-composer-tools-schedule-desc"
            , enabled = Schedule.canScheduleComposer gate
            , msg = Polish.ToolsSchedule
            , extra =
                [ attribute "aria-haspopup" "dialog"
                , attribute "aria-expanded" (boolAttr model.scheduleOpen)
                ]
            }
         , item
            { testId = "composer-jump-to-date"
            , label = "Jump to date in conversation history"
            , titleText = "Jump to date"
            , desc = "Open the conversation at a day you choose."
            , descId = "shell-composer-tools-jump-desc"
            , enabled = model.activeChannel /= Nothing
            , msg = Polish.ToolsJump
            , extra = []
            }
         , item
            { testId = "composer-tools-emoji"
            , label = "Insert emoji"
            , titleText = "Emoji"
            , desc = "Search and add an emoji to your message."
            , descId = "shell-composer-tools-emoji-desc"
            , enabled = model.activeChannel /= Nothing
            , msg = Polish.ToolsEmoji
            , extra = [ attribute "aria-haspopup" "dialog" ]
            }
         ]
            ++ (case room of
                    Just channel ->
                        [ a
                            [ class "shell-composer-tools-item shell-composer-tools-ledger"
                            , href (App.statsRoomHref channel)
                            , attribute "aria-label" ("Room ledger for " ++ channel)
                            , attribute "data-testid" "composer-channel-ledger"
                            ]
                            [ span [ class "shell-composer-tools-item-title" ] [ text "Room ledger" ]
                            , span [ class "shell-composer-tools-item-desc" ] [ text ("Public room pulse for " ++ channel ++ ".") ]
                            ]
                        ]

                    Nothing ->
                        []
               )
            ++ [ div [ class "shell-composer-tools-tip", attribute "role" "note" ]
                    [ p [ class "shell-composer-tools-item-title" ] [ text "Slash commands" ]
                    , p [ class "shell-composer-tools-item-desc" ]
                        [ text "Type "
                        , Html.kbd [ class "shell-composer-tools-kbd" ] [ text "/" ]
                        , text " for commands. Nothing runs until you send."
                        ]
                    , button
                        [ type_ "button"
                        , class "shell-composer-tools-action"
                        , attribute "data-testid" "composer-command-help"
                        , disabled (model.activeChannel == Nothing)
                        , onClick (PolishMsg Polish.ToolsSlash)
                        ]
                        [ text "Insert /" ]
                    ]
               ]
        )


item :
    { testId : String
    , label : String
    , titleText : String
    , desc : String
    , descId : String
    , enabled : Bool
    , msg : Polish.Msg
    , extra : List (Html.Attribute Msg)
    }
    -> Html Msg
item cfg =
    button
        ([ type_ "button"
         , class "shell-composer-tools-item"
         , attribute "data-testid" cfg.testId
         , attribute "aria-label" cfg.label
         , attribute "aria-describedby" cfg.descId
         , disabled (not cfg.enabled)
         , onClick (PolishMsg cfg.msg)
         ]
            ++ cfg.extra
        )
        [ span [ class "shell-composer-tools-item-title" ] [ text cfg.titleText ]
        , span [ class "shell-composer-tools-item-desc", id cfg.descId ] [ text cfg.desc ]
        ]


escapeKey : Decode.Decoder Msg
escapeKey =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Escape" then
                    Decode.succeed (PolishMsg Polish.ToolsClose)

                else
                    Decode.fail "not-escape"
            )



-- TIME SCRUBBER


{-| The room header More entry (rooms only). -}
scrubberToggle : Model -> Html Msg
scrubberToggle model =
    case App.polishScrubberRoom model of
        Nothing ->
            text ""

        Just _ ->
            let
                open =
                    model.polish.scrubber.open
            in
            button
                [ type_ "button"
                , class "onyx-scrubber-toggle"
                , attribute "aria-pressed" (boolAttr open)
                , attribute "aria-controls" "time-scrubber"
                , attribute "data-testid" "room-time-scrubber"
                , onClick
                    (PolishMsg
                        (if open then
                            Polish.ScrubberClose

                         else
                            Polish.ScrubberOpen
                        )
                    )
                ]
                [ text "Time scrubber" ]


timeScrubber : Model -> Html Msg
timeScrubber model =
    let
        scrubber =
            model.polish.scrubber
    in
    case ( scrubber.open, App.polishScrubberRoom model ) of
        ( True, Just channel ) ->
            let
                bars =
                    Polish.buildBars (Maybe.map .hours scrubber.pulse) (Polish.utcHour model.nowMs)

                copyLabel =
                    case scrubber.copy of
                        Polish.CopyCopied _ ->
                            "Copied"

                        Polish.CopyFailed ->
                            "Copy failed"

                        Polish.CopyIdle ->
                            "Copy moment"

                copyAnnounce =
                    case scrubber.copy of
                        Polish.CopyCopied _ ->
                            "Moment link copied for " ++ channel

                        Polish.CopyFailed ->
                            "Could not copy moment link for " ++ channel ++ ". Clipboard access is unavailable."

                        Polish.CopyIdle ->
                            ""
            in
            section
                [ id "time-scrubber"
                , class "time-scrubber"
                , attribute "aria-label" ("Time scrubber for " ++ channel)
                , attribute "aria-describedby" "time-scrubber-status"
                , attribute "data-testid" "time-scrubber"
                ]
                [ div [ class "time-scrubber__inner" ]
                    [ div [ class "time-scrubber__main" ]
                        [ div [ class "time-scrubber__head" ]
                            [ span [ class "time-scrubber__label" ] [ text "24h UTC" ]
                            , span [ id "time-scrubber-status", class "time-scrubber__status", attribute "aria-live" "polite" ]
                                [ text (Polish.scrubberStatus Stats.formatCount scrubber) ]
                            , a
                                [ class "time-scrubber__ledger"
                                , href (App.statsRoomHref channel)
                                , attribute "aria-label" ("Room ledger for " ++ channel)
                                ]
                                [ text "Ledger" ]
                            , button
                                [ type_ "button"
                                , class "time-scrubber__close"
                                , attribute "aria-label" "Close time scrubber"
                                , onClick (PolishMsg Polish.ScrubberClose)
                                ]
                                [ text "Close" ]
                            ]
                        , div
                            [ class "time-scrubber__track"
                            , attribute "role" "toolbar"
                            , attribute "aria-label" ("Activity by UTC hour for " ++ channel)
                            ]
                            (List.map (hourBar scrubber) bars)
                        ]
                    , label [ class "time-scrubber__date" ]
                        [ span [] [ text "jump date" ]
                        , input
                            [ type_ "date"
                            , attribute "data-time-scrubber-date" ""
                            , value scrubber.date
                            , attribute "aria-label" "Jump to date at 12:00 UTC"
                            , onInput (PolishMsg << Polish.ScrubberDate)
                            ]
                            []
                        ]
                    , button
                        [ type_ "button"
                        , class "time-scrubber__copy"
                        , attribute "aria-label" ("Copy moment link for " ++ channel)
                        , onClick (PolishMsg Polish.ScrubberCopy)
                        ]
                        [ text copyLabel ]
                    , span [ class "sr-only", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                        [ text copyAnnounce ]
                    ]
                ]

        _ ->
            text ""


hourBar : Polish.Scrubber -> Polish.Bar -> Html Msg
hourBar scrubber bar =
    button
        [ type_ "button"
        , id ("time-scrubber-hour-" ++ String.fromInt bar.hour)
        , class "time-scrubber__bar"
        , classList
            [ ( "time-scrubber__bar--live", bar.active )
            , ( "time-scrubber__bar--now", bar.isNow )
            ]
        , attribute "style" ("--scrub-heat: " ++ fixed3 bar.heat)
        , attribute "aria-label" (Polish.barLabel bar scrubber.date)
        , title (Polish.pad2 bar.hour ++ ":00 UTC - " ++ String.fromInt bar.count ++ " msgs")
        , attribute "tabindex"
            (if scrubber.roving == bar.hour then
                "0"

             else
                "-1"
            )
        , custom "keydown" (roveKey bar.hour)
        , onClick (PolishMsg (Polish.ScrubberHour bar.hour))
        ]
        [ span [ class "time-scrubber__bar-fill", attribute "aria-hidden" "true" ] [] ]


roveKey : Int -> Decode.Decoder { message : Msg, stopPropagation : Bool, preventDefault : Bool }
roveKey hour =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                let
                    go target =
                        Decode.succeed { message = PolishMsg (Polish.ScrubberRove target), stopPropagation = False, preventDefault = True }
                in
                case key of
                    "ArrowRight" ->
                        go (hour + 1)

                    "ArrowDown" ->
                        go (hour + 1)

                    "ArrowLeft" ->
                        go (hour - 1)

                    "ArrowUp" ->
                        go (hour - 1)

                    "Home" ->
                        go 0

                    "End" ->
                        go 23

                    _ ->
                        Decode.fail "not-a-rove-key"
            )


fixed3 : Float -> String
fixed3 x =
    let
        scaled =
            round (x * 1000)

        whole =
            scaled // 1000

        frac =
            String.padLeft 3 '0' (String.fromInt (modBy 1000 scaled))
    in
    String.fromInt whole ++ "." ++ frac



-- FIRST-RUN NOTIFY


firstRunNotify : Model -> Html Msg
firstRunNotify model =
    if not (App.firstRunNotifyOffered model) then
        text ""

    else
        let
            scope =
                "first-run-notify"

            close =
                PolishMsg Polish.NotifyDismiss
        in
        Sheet.view
            (sheetConfig scope close "first-run-notify")
            [ Sheet.header
                { scope = scope
                , title = Polish.firstRunNotifyTitle
                , closeLabel = "Not now"
                , onClose = close
                , closeTestId = Nothing
                }
            , p [ class "onyx-sheet-lede" ] [ text Polish.firstRunNotifyLede ]
            , div [ class "first-run-notify" ]
                [ p [ class "first-run-notify__note" ]
                    [ text "You can change this later in notification settings. Your browser may ask for permission." ]
                , div [ class "first-run-notify__actions" ]
                    [ button
                        [ type_ "button"
                        , class "polish-primary"
                        , attribute "data-testid" "first-run-notify-enable"
                        , disabled model.polish.notifyBusy
                        , Sheet.autofocus scope
                        , onClick (PolishMsg Polish.NotifyEnable)
                        ]
                        [ text "Turn on" ]
                    , button
                        [ type_ "button"
                        , class "polish-ghost"
                        , attribute "data-testid" "first-run-notify-dismiss"
                        , onClick close
                        ]
                        [ text "Not now" ]
                    ]
                ]
            ]



-- ADD TO HOME SCREEN


addToHomeScreen : Model -> Html Msg
addToHomeScreen model =
    if not (App.a2hsOffered model) then
        text ""

    else
        let
            scope =
                "a2hs"

            close =
                PolishMsg Polish.A2hsDismiss

            a2hs =
                model.polish.a2hs

            copy =
                Polish.a2hsCopyFor a2hs.platform

            canPrompt =
                a2hs.platform /= Polish.Ios && a2hs.captured
        in
        Sheet.view
            (sheetConfig scope close "a2hs-sheet")
            [ Sheet.header
                { scope = scope
                , title = Polish.a2hsTitle
                , closeLabel = "Dismiss Home Screen reminder"
                , onClose = close
                , closeTestId = Nothing
                }
            , p [ class "onyx-sheet-lede" ] [ text copy.lede ]
            , div [ class "a2hs-sheet" ]
                [ case copy.detail of
                    Just detail ->
                        p [ class "a2hs-sheet__detail" ] [ text detail ]

                    Nothing ->
                        text ""
                , div [ class "a2hs-sheet__actions" ]
                    ((if canPrompt then
                        [ button
                            [ type_ "button"
                            , class "polish-primary"
                            , attribute "data-testid" "a2hs-add"
                            , Sheet.autofocus scope
                            , onClick (PolishMsg Polish.A2hsAdd)
                            ]
                            [ text "Add to Home Screen" ]
                        ]

                      else
                        []
                     )
                        ++ [ button
                                [ type_ "button"
                                , class "polish-ghost"
                                , attribute "data-testid" "a2hs-dismiss"
                                , onClick close
                                ]
                                [ text "Not now" ]
                           ]
                    )
                , if String.isEmpty a2hs.status then
                    text ""

                  else
                    p [ class "a2hs-sheet__status", attribute "role" "status", attribute "aria-live" "polite" ] [ text a2hs.status ]
                ]
            ]


sheetConfig : String -> Msg -> String -> Sheet.Config Msg
sheetConfig scope close testId =
    let
        base =
            Sheet.config { scope = scope, onClose = close }
    in
    { base
        | panelClass = "polish-sheet"
        , attrs = [ attribute "data-testid" testId ]
    }



-- UPDATE AVAILABLE


updateBanner : Model -> Html Msg
updateBanner model =
    let
        upd =
            model.polish.update
    in
    if not upd.available || upd.reloading then
        text ""

    else
        let
            copy =
                Polish.updateMessage (App.polishWorkActive model)
        in
        div
            [ class "update-available"
            , attribute "role" "status"
            , attribute "aria-live" "polite"
            , attribute "aria-atomic" "true"
            , attribute "data-testid" "update-available"
            ]
            [ p [ class "update-available__message", id "update-available-message" ] [ text copy.message ]
            , button
                [ type_ "button"
                , attribute "aria-describedby" "update-available-message"
                , onClick (PolishMsg Polish.UpdateApprove)
                ]
                [ text copy.button ]
            ]


boolAttr : Bool -> String
boolAttr on =
    if on then
        "true"

    else
        "false"
