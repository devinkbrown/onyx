module View.ModDesk exposing (deskToggles, moderationSheet, moderationToggle, operSheet, operToggle)

{-| v3/moddesk — the moderation cockpit and the operator desk as sheets.

  - `deskToggles`: the room-level desk button (moderators get
    "Moderation", members "Room safety"; v3/gap-people) and the
    Operator button (server operators only, via `model.isOper`).
  - `moderationSheet`: the room desk (mirroring
    `shell/ModerationCockpit.tsx`) — current-room header, then the
    `View.Bans` body (authority rail, safeguards, invite, member action,
    mask block, timed block, block list, server activity, open wire).
    The member/mask review renders inside the sheet so it is never
    hidden under the veil.
  - `operSheet`: `shell/OperDesk.tsx` (announce / Event Spine
    subscriptions / privileges / reload config / observe / disconnect,
    destructive plans behind an inline review) plus
    `shell/OperEventConsole.tsx` (bounded `EVENT REPLAY JSON`, local
    category / severity / text filters), plus `View.OperTabs` (v3/gap-oper).

Roles read as words ("Room moderator", "IRC operator", "Network
administrator"), never as mode letters.

-}

import App exposing (ConnectionState(..), Model, Msg(..), OperDeskIntent(..), isChannelOp)
import EventReplay exposing (EventReplayEvent)
import Html exposing (Html, button, code, details, div, dl, dd, dt, h3, input, label, li, option, p, section, select, span, summary, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, placeholder, selected, tabindex, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit, preventDefaultOn)
import Json.Decode as Decode
import OperConsole exposing (Field(..))
import OperDesk
import OperPlan
import OperReply exposing (Section(..))
import View.Bans exposing (banPanel)
import View.OperFeedPanel as OperFeedPanel
import View.OperKit as OperKit
import View.OperTabs as OperTabs
import View.Profile exposing (moderationReview)
import View.Sheet as Sheet


{-| Topbar entries. Each renders only for the authority it opens. -}
deskToggles : Model -> Html Msg
deskToggles model =
    case moderationToggle model ++ operToggle model of
        [] ->
            text ""

        buttons ->
            span [ class "onyx-moddesk-toggles" ] buttons


{-| v3/frame — the room-scoped Moderation entry (the room header's
More menu). v3/gap-people: room moderators get "Moderation"; members
get "Room safety", the read-only desk (safeguards, who moderates,
the open-wire mode state). Empty outside rooms we are in.
-}
moderationToggle : Model -> List (Html Msg)
moderationToggle model =
    case model.activeChannel of
        Just channel ->
            let
                moderator =
                    isChannelOp model channel
            in
            if moderator || App.isRoomMember model channel then
                [ button
                    [ type_ "button"
                    , class "onyx-moddesk-toggle"
                    , attribute "aria-pressed" (boolAttr model.moderationOpen)
                    , attribute "aria-label"
                        ((if moderator then
                            "Moderation for "

                          else
                            "Room safety for "
                         )
                            ++ channel
                        )
                    , attribute "data-testid" "moderation-open"
                    , onClick ModerationSheetOpen
                    ]
                    [ text
                        (if moderator then
                            "Moderation"

                         else
                            "Room safety"
                        )
                    ]
                ]

            else
                []

        Nothing ->
            []


{-| v3/frame — the network-scoped Operator entry (the global topbar);
empty unless we are a server operator.
-}
operToggle : Model -> List (Html Msg)
operToggle model =
    if model.isOper then
        [ button
            [ type_ "button"
            , class "onyx-moddesk-toggle"
            , attribute "aria-pressed" (boolAttr model.operDeskOpen)
            , attribute "data-testid" "oper-desk-open"
            , onClick OperDeskOpen
            ]
            [ text "Operator" ]
        ]

    else
        []


boolAttr : Bool -> String
boolAttr on =
    if on then
        "true"

    else
        "false"


-- MODERATION SHEET


moderationSheet : Model -> Html Msg
moderationSheet model =
    case ( model.moderationOpen, model.activeChannel ) of
        ( True, Just channel ) ->
            sheetFrame
                { close = ModerationSheetClose
                , titleId = "moderation-cockpit-title"
                , testId = "moderation-cockpit"
                , closeLabel = "Close room desk"
                , kicker = "Room safety"
                , title = "Room desk"
                , subtitle = Just channel
                }
                [ p [ class "onyx-moddesk-role" ]
                    [ text
                        (if isChannelOp model channel then
                            "You are a room moderator here."

                         else
                            "You are a member here."
                        )
                    ]
                , banPanel model channel
                , moderationReview model
                ]

        _ ->
            text ""


type alias Frame =
    { close : Msg
    , titleId : String
    , testId : String
    , closeLabel : String
    , kicker : String
    , title : String
    , subtitle : Maybe String
    }


sheetFrame : Frame -> List (Html Msg) -> Html Msg
sheetFrame frame body =
    Sheet.view
        { scope = frame.testId
        , label = Sheet.LabelledBy frame.titleId
        , onClose = frame.close
        , placement = Sheet.Side
        , layerClass = "onyx-moddesk"
        , panelClass = "onyx-moddesk-sheet"
        , backdropClass = "onyx-moddesk-backdrop"
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" frame.testId ]
        }
            -- v3/rx-sheets: the shared pinned head (kicker, title, the
            -- room as subtitle, the one close) for both desks.
            (Sheet.headerWith
                (Sheet.head { scope = frame.testId, title = frame.title, closeLabel = frame.closeLabel, onClose = frame.close }
                    |> (\h ->
                            { h
                                | titleId = Just frame.titleId
                                , kicker = Just frame.kicker
                                , subtitle = frame.subtitle
                                , closeClass = "onyx-moddesk-close"
                                , headClass = "onyx-moddesk-head"
                            }
                       )
                )
                :: body
            )


-- OPERATOR SHEET (v3/gap-oper: tabs)


operSheet : Model -> Html Msg
operSheet model =
    if model.operDeskOpen && model.isOper then
        sheetFrame
            { close = OperDeskClose
            , titleId = "oper-desk-title"
            , testId = "oper-sheet"
            , closeLabel = "Close operator desk"
            , kicker = "Network"
            , title = "Operator desk"
            , subtitle = Nothing
            }
            [ operDesk model ]

    else
        text ""


operDesk : Model -> Html Msg
operDesk model =
    let
        desk =
            model.operDesk

        live =
            model.connection == Live

        tab =
            model.operConsole.tab
    in
    section [ class "oper-desk", attribute "data-testid" "oper-desk", attribute "aria-labelledby" "oper-desk-title" ]
        ([ dl [ class "onyx-moddesk-rail oc-rail", attribute "aria-label" "Operator authority" ]
            [ div []
                [ dt [] [ text "Role" ]
                , dd [ attribute "data-testid" "oper-desk-role" ] [ text (OperDesk.roleLabel model.isNetworkAdmin) ]
                ]
            , div []
                [ dt [] [ text "Network" ]
                , dd [] [ text "Onyx" ]
                ]
            , div []
                [ dt [] [ text "Signed in as" ]
                , dd []
                    [ text
                        (if String.isEmpty model.ourNick then
                            "Unknown"

                         else
                            model.ourNick
                        )
                    ]
                ]
            ]
         ]
            ++ (if live then
                    []

                else
                    [ p [ class "onyx-moddesk-offline", attribute "role" "status", attribute "data-testid" "oper-desk-offline" ]
                        [ text "Reconnect to send operator commands. Drafts stay on this device." ]
                    ]
               )
            ++ (if List.isEmpty desk.errors then
                    []

                else
                    [ ul [ class "onyx-moddesk-errors", attribute "role" "alert", attribute "data-testid" "oper-desk-errors" ]
                        (List.map (\e -> li [] [ text e ]) desk.errors)
                    ]
               )
            ++ reviewBlock live desk
            ++ [ tabStrip model
               , div
                    [ class "oc-tabpanel"
                    , attribute "role" "tabpanel"
                    , id "oc-tabpanel"
                    , attribute "aria-labelledby" (OperConsole.tabId tab)
                    , attribute "tabindex" "0"
                    ]
                    [ tabBody model tab ]
               ]
        )


tabStrip : Model -> Html Msg
tabStrip model =
    div [ class "oc-tabs", attribute "data-testid" "oc-tabs" ]
        [ div
            [ class "oc-tablist"
            , attribute "role" "tablist"
            , attribute "aria-label" "Operator desk sections"
            ]
            (List.map (tabButton model.operConsole.tab) OperReply.sections)
        ]



tabButton : Section -> Section -> Html Msg
tabButton current section =
    let
        selected =
            current == section
    in
    button
        [ type_ "button"
        , class "oc-tab"
        , id (OperConsole.tabId section)
        , attribute "role" "tab"
        , attribute "aria-selected" (boolAttr selected)
        , attribute "aria-controls" "oc-tabpanel"
        , attribute "data-testid" ("oc-tab-" ++ String.toLower (OperReply.sectionLabel section))
        , tabindex
            (if selected then
                0

             else
                -1
            )
        , onClick (OperConsoleMsg (OperConsole.SelectTab section))
        , preventDefaultOn "keydown"
            (Decode.field "key" Decode.string
                |> Decode.andThen
                    (\key ->
                        if OperConsole.tabKeyHandled key then
                            Decode.succeed ( OperConsoleMsg (OperConsole.TabKey key), True )

                        else
                            Decode.fail "unhandled"
                    )
            )
        ]
        [ text (OperReply.sectionLabel section) ]


tabBody : Model -> Section -> Html Msg
tabBody model tab =
    case tab of
        Feed ->
            liveTab model

        Bans ->
            OperTabs.bansTab model

        Silence ->
            OperTabs.silenceTab model

        Abuse ->
            OperTabs.abuseTab model

        Appeals ->
            OperTabs.appealsTab model

        Content ->
            OperTabs.contentTab model

        Network ->
            networkTab model



-- LIVE


liveTab : Model -> Html Msg
liveTab model =
    div [ class "oc-panel", attribute "data-testid" "oc-panel-live" ]
        [ OperKit.lede "What the network reports to operators, as it happens. The feed keeps the latest 400 rows and never sends a command when you filter it."
        , OperFeedPanel.followPanel model
        , OperFeedPanel.feedPanel model
        , OperKit.disclosure { id = "announce", title = "Announce to operators", hint = "A message every following operator sees", open = False }
            [ announceForm model ]
        , OperKit.disclosure { id = "history", title = "Earlier events", hint = "Ask the node to replay what happened before you opened the desk", open = False }
            [ eventConsole model ]
        , OperKit.disclosure { id = "counts", title = "Event counts", hint = "How busy the network has been", open = False }
            [ OperFeedPanel.statsPanel model ]
        , OperKit.repliesLog model Feed
        ]


announceForm : Model -> Html Msg
announceForm model =
    let
        desk =
            model.operDesk

        live =
            model.connection == Live

        remaining =
            App.maxBroadcastLength - String.length (String.trim desk.broadcast)
    in
    Html.form
        [ class "onyx-moddesk-form oc-form"
        , attribute "data-testid" "oper-desk-broadcast-form"
        , onSubmit (OperDeskSubmit (OperBroadcast desk.broadcast))
        ]
        [ label [ for "oper-desk-broadcast" ] [ text "Announce to operators" ]
        , div [ class "onyx-moddesk-row" ]
            [ input
                [ id "oper-desk-broadcast"
                , attribute "data-testid" "oper-desk-broadcast-input"
                , value desk.broadcast
                , maxlength App.maxBroadcastLength
                , attribute "autocomplete" "off"
                , placeholder "Maintenance at 03:00 UTC"
                , onInput (OperDeskField OperDesk.Broadcast)
                ]
                []
            , button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not live || String.trim desk.broadcast == "") ]
                [ text "Review announcement" ]
            ]
        , p [ class "onyx-moddesk-hint" ]
            [ text ("EVENT BROADCAST reaches operators following Announce, not every member. " ++ String.fromInt remaining ++ " characters left.") ]
        ]



-- NETWORK


networkTab : Model -> Html Msg
networkTab model =
    let
        desk =
            model.operDesk

        live =
            model.connection == Live

        console =
            model.operConsole

        submitOn intent =
            onSubmit (OperDeskSubmit intent)
    in
    div [ class "oc-panel", attribute "data-testid" "oc-panel-network" ]
        [ OperKit.lede "Actions on a person or on this node, and read-only reports about the mesh."
        , OperKit.disclosure { id = "watch", title = "Watch someone", hint = "Their activity appears in the Live feed", open = False }
            [ Html.form
                [ class "onyx-moddesk-form oc-form"
                , attribute "data-testid" "oper-desk-observe-form"
                , submitOn (OperObserve { mask = desk.mask, actions = [] })
                ]
                [ label [ for "oper-desk-mask" ] [ text "Mask to watch" ]
                , div [ class "onyx-moddesk-row" ]
                    [ input
                        [ id "oper-desk-mask"
                        , attribute "data-testid" "oper-desk-mask"
                        , value desk.mask
                        , attribute "autocomplete" "off"
                        , placeholder "name!*@*.example"
                        , onInput (OperDeskField OperDesk.Mask)
                        ]
                        []
                    , button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not live || String.trim desk.mask == "") ] [ text "Observe" ]
                    ]
                , p [ class "onyx-moddesk-hint" ]
                    [ text "OBSERVE reveals the subject’s real, uncloaked host to you. Use the narrowest mask that answers the question." ]
                , div [ class "onyx-moddesk-actions" ]
                    [ button
                        [ type_ "button"
                        , class "oc-btn oc-btn-quiet"
                        , attribute "data-testid" "oper-desk-observe-list"
                        , disabled (not live)
                        , onClick (OperDeskSubmit OperObserveList)
                        ]
                        [ text "List watches" ]
                    , button
                        [ type_ "button"
                        , class "oc-btn oc-btn-quiet"
                        , attribute "data-testid" "oper-desk-observe-off"
                        , disabled (not live)
                        , onClick (OperDeskSubmit OperObserveOff)
                        ]
                        [ text "Clear watches" ]
                    ]
                ]
            ]
        , OperKit.disclosure { id = "disconnect", title = "Disconnect someone", hint = "Ends their session network-wide", open = False }
            [ Html.form
                [ class "onyx-moddesk-form oc-form"
                , attribute "data-testid" "oper-desk-kill-form"
                , submitOn (OperKill { target = desk.killNick, reason = desk.killReason })
                ]
                [ label [ for "oper-desk-kill-nick" ] [ text "Nickname" ]
                , input
                    [ id "oper-desk-kill-nick"
                    , attribute "data-testid" "oper-desk-kill-nick"
                    , value desk.killNick
                    , attribute "autocomplete" "off"
                    , placeholder "Nickname"
                    , onInput (OperDeskField OperDesk.KillNick)
                    ]
                    []
                , label [ for "oper-desk-kill-reason" ] [ text "Reason (recorded network-wide)" ]
                , div [ class "onyx-moddesk-row" ]
                    [ input
                        [ id "oper-desk-kill-reason"
                        , attribute "data-testid" "oper-desk-kill-reason"
                        , value desk.killReason
                        , attribute "autocomplete" "off"
                        , placeholder "Repeat flooding after a warning"
                        , onInput (OperDeskField OperDesk.KillReason)
                        ]
                        []
                    , button
                        [ type_ "submit"
                        , class "oc-btn oc-btn-danger"
                        , attribute "data-testid" "oper-desk-kill-submit"
                        , disabled (not live || String.trim desk.killNick == "" || String.trim desk.killReason == "")
                        ]
                        [ text "Review disconnect" ]
                    ]
                ]
            ]
        , OperKit.card { id = "node", title = "This node", hint = "" }
            [ div [ class "onyx-moddesk-actions" ]
                [ button
                    [ type_ "button"
                    , class "oc-btn oc-btn-quiet"
                    , attribute "data-testid" "oper-desk-privs"
                    , disabled (not live)
                    , onClick (OperDeskSubmit OperPrivs)
                    ]
                    [ text "Show my privileges" ]
                , button
                    [ type_ "button"
                    , class "oc-btn oc-btn-danger"
                    , attribute "data-testid" "oper-desk-rehash"
                    , disabled (not live)
                    , onClick (OperDeskSubmit OperRehash)
                    ]
                    [ text "Reload node config" ]
                ]
            , case console.privileges of
                Just privs ->
                    div [ class "oc-result", attribute "data-testid" "oc-privileges" ]
                        [ p [ class "oc-result-head" ] [ text ("Your class is " ++ privs.class ++ ".") ]
                        , ul [ class "oc-tags" ]
                            (List.map (\priv -> li [ class "oc-tag" ] [ text (String.replace "_" " " priv) ]) privs.privileges)
                        ]

                Nothing ->
                    text ""
            ]
        , accountsCard model
        , nodeControlsCard model
        , reportsCard model
        , auditCard model
        , OperKit.repliesLog model Network
        , case desk.lastSent of
            Just sent ->
                p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-desk-last-sent" ]
                    [ text ("Sent " ++ sent) ]

            Nothing ->
                text ""
        , details [ class "moderation-cockpit__protocol" ]
            [ summary [] [ text "Open-wire details" ]
            , p [] [ text "This network grants operator status from the signed-in account — there is no OPER command, and a broadcast rides the Event Spine rather than a user-mode WALLOPS." ]
            , code [] [ text "EVENT BROADCAST · EVENT ADD/DEL/LIST · EVENT OBSERVE · REHASH · PRIVS · KILL" ]
            ]
        ]


{-| Account administration: look an account up, then suspend, forbid or
pin it. Every change is reviewed before it is sent, and the daemon's
one-line report refreshes the card. -}
accountsCard : Model -> Html Msg
accountsCard model =
    let
        console =
            model.operConsole

        name =
            console.forms.accountName

        ready =
            model.connection == Live && String.trim name /= ""

        act action on =
            OperConsoleMsg (OperConsole.Run (OperPlan.AccountAdmin { action = action, account = name, on = on }))

        known =
            case console.account of
                Just status ->
                    String.toLower status.name == String.toLower (String.trim name)

                Nothing ->
                    False
    in
    OperKit.disclosure { id = "accounts", title = "Accounts", hint = "Look up, suspend, forbid or pin an account", open = False }
        [ Html.form
            [ class "oc-form"
            , attribute "data-testid" "oc-account-form"
            , onSubmit (act "INFO" True)
            ]
            [ OperKit.formRow
                [ OperKit.field { id = "oc-account-name", label = "Account name", hint = "" }
                    (OperKit.textInput
                        { id = "oc-account-name"
                        , value = name
                        , placeholder = "bobby"
                        , onChange = \v -> OperConsoleMsg (OperConsole.Edit AccountName v)
                        , testId = "oc-account-name"
                        , mono = False
                        , max = 64
                        }
                    )
                , Html.button
                    [ type_ "submit"
                    , class "oc-btn oc-btn-primary oc-btn-align"
                    , disabled (not ready)
                    , attribute "data-testid" "oc-account-look"
                    ]
                    [ text "Look up" ]
                ]
            ]
        , case console.account of
            Just status ->
                div [ class "oc-result", attribute "data-testid" "oc-account-result" ]
                    [ p [ class "oc-result-head" ] [ text (status.name ++ ": " ++ OperReply.accountSummary status ++ ".") ]
                    , if known && model.connection == Live then
                        div [ class "oc-row" ]
                            [ OperKit.button_
                                { kind =
                                    if status.suspended then
                                        "quiet"

                                    else
                                        "danger"
                                , label =
                                    if status.suspended then
                                        "Unsuspend"

                                    else
                                        "Suspend"
                                , testId = "oc-account-suspend"
                                , onClick =
                                    act
                                        (if status.suspended then
                                            "UNSUSPEND"

                                         else
                                            "SUSPEND"
                                        )
                                        True
                                , disabled = not status.registered
                                , ariaLabel = Nothing
                                }
                            , OperKit.button_
                                { kind =
                                    if status.forbidden then
                                        "quiet"

                                    else
                                        "danger"
                                , label =
                                    if status.forbidden then
                                        "Allow name again"

                                    else
                                        "Forbid name"
                                , testId = "oc-account-forbid"
                                , onClick =
                                    act
                                        (if status.forbidden then
                                            "UNFORBID"

                                         else
                                            "FORBID"
                                        )
                                        True
                                , disabled = False
                                , ariaLabel = Nothing
                                }
                            , OperKit.button_
                                { kind = "quiet"
                                , label =
                                    if status.noexpire then
                                        "Let it expire"

                                    else
                                        "Never expire"
                                , testId = "oc-account-noexpire"
                                , onClick = act "NOEXPIRE" (not status.noexpire)
                                , disabled = not status.registered
                                , ariaLabel = Nothing
                                }
                            ]

                      else
                        text ""
                    ]

            Nothing ->
                text ""
        ]


{-| Node-level controls: one picker, one or two arguments, always reviewed. -}
nodeControlsCard : Model -> Html Msg
nodeControlsCard model =
    let
        forms =
            model.operConsole.forms

        chosen =
            OperPlan.serverActions
                |> List.filter (\a -> a.action == forms.serverAction)
                |> List.head

        ready =
            model.connection == Live

        edit_ field v =
            OperConsoleMsg (OperConsole.Edit field v)
    in
    OperKit.disclosure { id = "node-controls", title = "Node controls", hint = "Drain, link, unlink, clear a penalty, message everyone", open = False }
        [ Html.form
            [ class "oc-form"
            , attribute "data-testid" "oc-node-form"
            , onSubmit (OperConsoleMsg (OperConsole.Run (OperPlan.ServerAction { action = forms.serverAction, arg = forms.serverArg, arg2 = forms.serverArg2 })))
            ]
            ([ OperKit.field { id = "oc-node-action", label = "Action", hint = Maybe.withDefault "" (Maybe.map .hint chosen) }
                (OperKit.selectInput
                    { id = "oc-node-action"
                    , value = forms.serverAction
                    , options = List.map (\a -> ( a.action, a.label )) OperPlan.serverActions
                    , onChange = edit_ ServerActionPick
                    , testId = "oc-node-action"
                    }
                )
             ]
                ++ (case chosen of
                        Just a ->
                            (if a.arg == "" then
                                []

                             else
                                [ OperKit.field { id = "oc-node-arg", label = a.arg, hint = "" }
                                    (OperKit.textInput
                                        { id = "oc-node-arg"
                                        , value = forms.serverArg
                                        , placeholder = ""
                                        , onChange = edit_ ServerArg
                                        , testId = "oc-node-arg"
                                        , mono = a.action /= "GLOBAL"
                                        , max = 400
                                        }
                                    )
                                ]
                            )
                                ++ (if a.arg2 == "" then
                                        []

                                    else
                                        [ OperKit.field { id = "oc-node-arg2", label = a.arg2, hint = "" }
                                            (OperKit.textInput
                                                { id = "oc-node-arg2"
                                                , value = forms.serverArg2
                                                , placeholder = ""
                                                , onChange = edit_ ServerArg2
                                                , testId = "oc-node-arg2"
                                                , mono = True
                                                , max = 5
                                                }
                                            )
                                        ]
                                   )

                        Nothing ->
                            []
                   )
                ++ [ OperKit.formRow
                        [ button
                            [ type_ "submit"
                            , class "oc-btn oc-btn-danger"
                            , disabled (not ready)
                            , attribute "data-testid" "oc-node-submit"
                            ]
                            [ text "Review" ]
                        ]
                   ]
            )
        ]


{-| The last operator actions the node recorded (`AUDIT`): who did what
to whom, with the proof id the daemon signed it with. -}
auditCard : Model -> Html Msg
auditCard model =
    let
        rows =
            model.operConsole.audit
    in
    OperKit.card { id = "audit", title = "Recent operator actions", hint = "The node's audit trail: who did what, with the proof id it signed." }
        [ OperKit.formRow
            [ OperKit.button_
                { kind = "quiet"
                , label = "Load the last 20"
                , testId = "oc-audit-load"
                , onClick = OperConsoleMsg (OperConsole.Run (OperPlan.ServerQuery { verb = "AUDIT", arg = "20" }))
                , disabled = model.connection /= Live
                , ariaLabel = Nothing
                }
            ]
        , if List.isEmpty rows then
            OperKit.emptyNote "Nothing loaded yet."

          else
            ul [ class "oc-report", attribute "data-testid" "oc-audit-rows", attribute "aria-label" "Audit trail" ]
                (List.map (\row -> li [] [ text row.text ]) rows)
        ]


{-| Read-only reports. Output is the Network reply log, in full. -}
reportsCard : Model -> Html Msg
reportsCard model =
    let
        console =
            model.operConsole

        pick =
            console.forms.reportPick

        parts =
            case String.split "|" pick of
                [ verb, arg ] ->
                    { verb = verb, arg = arg }

                _ ->
                    { verb = "MESH", arg = "" }

        chosen =
            OperPlan.serverQueries
                |> List.filter (\q -> q.verb == parts.verb && q.arg == parts.arg)
                |> List.head

        output =
            List.take 60 (List.filter (\l -> l.section == Network) console.log)
    in
    OperKit.card { id = "reports", title = "Reports", hint = "Read-only: ask the node how the mesh and the network are doing." }
        [ OperKit.formRow
            [ OperKit.field { id = "oc-report", label = "Report", hint = Maybe.withDefault "" (Maybe.map .hint chosen) }
                (OperKit.selectInput
                    { id = "oc-report"
                    , value = pick
                    , options = List.map (\q -> ( q.verb ++ "|" ++ q.arg, q.label )) OperPlan.serverQueries
                    , onChange = \v -> OperConsoleMsg (OperConsole.Edit ReportPick v)
                    , testId = "oc-report"
                    }
                )
            , OperKit.button_
                { kind = "primary"
                , label = "Run report"
                , testId = "oc-report-run"
                , onClick = OperConsoleMsg (OperConsole.Run (OperPlan.ServerQuery parts))
                , disabled = model.connection /= Live
                , ariaLabel = Nothing
                }
            ]
        , if List.isEmpty output then
            text ""

          else
            ul [ class "oc-report", attribute "data-testid" "oc-report-output", attribute "aria-label" "Report output" ]
                (List.map (\l -> li [ attribute "data-tone" (OperKit.toneAttr l.tone) ] [ text l.text ]) (List.reverse output))
        ]


reviewBlock : Bool -> OperDesk.Desk -> List (Html Msg)
reviewBlock live desk =
    case desk.pending of
        Nothing ->
            []

        Just command ->
            [ div
                [ class "onyx-moddesk-review"
                , attribute "role" "alertdialog"
                , attribute "aria-label" "Review operator action"
                , attribute "data-testid" "oper-desk-review"
                ]
                [ p [ attribute "data-testid" "oper-desk-review-summary" ] [ text command.summary ]
                , code [ class "onyx-moddesk-wire", attribute "data-testid" "oper-desk-review-wire" ]
                    [ text (OperDesk.formatWirePreview command) ]
                , div [ class "onyx-moddesk-actions" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-moddesk-danger"
                        , attribute "data-testid" "oper-desk-review-confirm"
                        , disabled (not live)
                        , onClick OperDeskConfirm
                        ]
                        [ text "Send it" ]
                    , button
                        [ type_ "button"
                        , attribute "data-testid" "oper-desk-review-cancel"
                        , onClick OperDeskCancel
                        ]
                        [ text "Cancel" ]
                    ]
                ]
            ]



-- EVENT CONSOLE (earlier events: EVENT REPLAY JSON)


eventConsole : Model -> Html Msg
eventConsole model =
    let
        desk =
            model.operDesk

        feed =
            model.operEventReplay

        canReplay =
            model.connection == Live

        rows =
            OperDesk.filterEventRows
                { category = desk.filterCategory, severity = desk.filterSeverity, text = desk.filterText }
                feed.events

        hasFeed =
            not (List.isEmpty feed.events)
    in
    section [ class "oper-event-console", attribute "data-testid" "oper-event-console", attribute "aria-label" "Earlier events" ]
        ([ p [ class "onyx-moddesk-hint" ]
            [ text "A bounded refresh of the node’s structured history feed. Filtering below is local and sends nothing." ]
         , div [ class "onyx-moddesk-row", attribute "data-testid" "oper-event-replay-toolbar" ]
            [ label [ class "onyx-moddesk-sr", for "oper-event-replay-limit" ] [ text "Number of events to refresh" ]
            , select
                [ id "oper-event-replay-limit"
                , attribute "data-testid" "oper-event-replay-limit"
                , on "change" (Decode.map OperEventReplayLimit (Decode.at [ "target", "value" ] Decode.string |> Decode.andThen intDecoder))
                ]
                (List.map
                    (\n -> option [ value (String.fromInt n), selected (n == desk.replayLimit) ] [ text (String.fromInt n ++ " events") ])
                    OperDesk.replayLimits
                )
            , button
                [ type_ "button"
                , attribute "data-testid" "oper-event-replay"
                , disabled (not canReplay)
                , onClick OperEventReplayRequested
                ]
                [ text "Refresh events" ]
            ]
         ]
            ++ (case desk.lastReplay of
                    Just request ->
                        [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-replay-status" ]
                            ([ text ("Requested " ++ request) ]
                                ++ (if feed.pending then
                                        [ span [ attribute "data-testid" "oper-event-replay-pending" ] [ text " · waiting…" ] ]

                                    else
                                        []
                                   )
                                ++ (if feed.complete then
                                        [ span [ attribute "data-testid" "oper-event-replay-complete" ]
                                            [ text
                                                (" · "
                                                    ++ String.fromInt (List.length rows)
                                                    ++ (case feed.expectedCount of
                                                            Just n ->
                                                                "/" ++ String.fromInt n

                                                            Nothing ->
                                                                ""
                                                       )
                                                    ++ " events"
                                                    ++ (case feed.severityFloor of
                                                            Just floor_ ->
                                                                if floor_ == "" then
                                                                    ""

                                                                else
                                                                    " · floor " ++ floor_

                                                            Nothing ->
                                                                ""
                                                       )
                                                )
                                            ]
                                        ]

                                    else
                                        []
                                   )
                            )
                        ]

                    Nothing ->
                        []
               )
            ++ (if hasFeed then
                    [ div [ class "onyx-moddesk-row", attribute "data-testid" "oper-event-filters" ]
                        [ label [ class "onyx-moddesk-sr", for "oper-event-filter-category" ] [ text "Filter by category" ]
                        , select
                            [ id "oper-event-filter-category"
                            , attribute "data-testid" "oper-event-filter-category"
                            , onInput (OperDeskField OperDesk.FilterCategory)
                            ]
                            (option [ value "", selected (desk.filterCategory == "") ] [ text "All categories" ]
                                :: List.map (\c -> option [ value c, selected (c == desk.filterCategory) ] [ text c ]) (OperDesk.eventCategoriesIn feed.events)
                            )
                        , label [ class "onyx-moddesk-sr", for "oper-event-filter-severity" ] [ text "Filter by severity" ]
                        , select
                            [ id "oper-event-filter-severity"
                            , attribute "data-testid" "oper-event-filter-severity"
                            , onInput (OperDeskField OperDesk.FilterSeverity)
                            ]
                            (option [ value "", selected (desk.filterSeverity == "") ] [ text "All severities" ]
                                :: List.map (\s -> option [ value s, selected (s == desk.filterSeverity) ] [ text s ]) (OperDesk.eventSeveritiesIn feed.events)
                            )
                        , label [ class "onyx-moddesk-sr", for "oper-event-filter-text" ] [ text "Filter events by text" ]
                        , input
                            [ id "oper-event-filter-text"
                            , attribute "data-testid" "oper-event-filter-text"
                            , type_ "search"
                            , value desk.filterText
                            , placeholder "Filter text"
                            , onInput (OperDeskField OperDesk.FilterText)
                            ]
                            []
                        ]
                    ]

                else
                    []
               )
            ++ (if List.isEmpty rows then
                    []

                else
                    [ ul [ class "onyx-moddesk-events", attribute "aria-label" "Structured event feed", attribute "data-testid" "oper-event-json-list" ]
                        (List.map (eventRow model.nowMs) rows)
                    ]
               )
            ++ (if hasFeed && List.isEmpty rows then
                    [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-filter-empty" ]
                        [ text "No events match these local filters." ]
                    ]

                else if not hasFeed then
                    [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-empty" ]
                        [ text "No recent spine-tagged notices yet." ]
                    ]

                else
                    []
               )
            ++ [ details [ class "moderation-cockpit__protocol" ]
                    [ summary [] [ text "Open-wire details" ]
                    , p [] [ text "Raw command used to refresh the structured feed. This does not send extra server commands when you filter locally." ]
                    , code [ attribute "data-testid" "oper-event-replay-wire" ] [ text (OperDesk.replayWire desk.replayLimit) ]
                    ]
               ]
        )


eventRow : Float -> EventReplayEvent -> Html Msg
eventRow nowMs event =
    li [ class "onyx-moddesk-event", attribute "data-testid" "oper-event-json-row" ]
        [ span [ class "onyx-moddesk-event-cat", attribute "data-testid" "oper-event-json-cat" ] [ text event.categoryCode ]
        , span [ class "onyx-moddesk-event-sev", attribute "data-testid" "oper-event-json-sev" ] [ text event.severity ]
        , span [ class "onyx-moddesk-event-text", attribute "data-testid" "oper-event-json-text" ]
            [ text (EventReplay.formatEventReplayEvent event nowMs) ]
        ]


intDecoder : String -> Decode.Decoder Int
intDecoder raw =
    case String.toInt raw of
        Just n ->
            Decode.succeed n

        Nothing ->
            Decode.fail "not an int"
