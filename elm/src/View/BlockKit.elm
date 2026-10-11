module View.BlockKit exposing (cards, overlay)

{-| v3/gap-import — BlockKit-lite structured messages (parity rows
E101–E104): the inline card under a message, and the two dialogs.

  - `cards` draws each valid `[onyx:block]` payload of a message as a
    quiet card: title, text, fields, selects, buttons. URL buttons name
    their destination host; copy buttons report Copied / Copy failed;
    action buttons and selects never send — they open the review
    dialog, and render disabled when they target another conversation.
  - `overlay` is the single dialog layer: the **send review** (exact
    destination and plaintext, Cancel focused first) and the
    **Inspect structured data** dialog (every field, option and
    destination in the payload).

All decoding, limits and the origin rule live in `BlockKit`; nothing
here parses or trusts payload text.

-}

import App exposing (Model, Msg(..))
import BlockKit as BK
import Html exposing (Html, a, button, code, dd, div, dl, dt, h3, h4, li, p, pre, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, href, id, rel, target, title, type_)
import Html.Events exposing (on, onClick)
import Html.Keyed
import Json.Decode as Decode
import View.Sheet as Sheet


type alias Env =
    { target : String
    , key : String
    , prefix : String
    }


msg : BK.Msg -> Msg
msg =
    BlockKitMsg



-- INLINE CARDS


{-| One card per valid block. `target` is the conversation the message
is in (the origin every action is checked against); `key` is a stable
per-message key.
-}
cards : Model -> { target : String, key : String } -> List BK.Block -> List (Html Msg)
cards model row blocks =
    List.indexedMap
        (\i block ->
            card model { target = row.target, key = row.key ++ "-" ++ String.fromInt i, prefix = "" } block
        )
        blocks


card : Model -> Env -> BK.Block -> Html Msg
card model env block =
    case block.kind of
        BK.ModalBlock trigger ->
            let
                openerId =
                    BK.controlId env.key "open"
            in
            div
                [ class "bk-card bk-card--modal"
                , attribute "role" "group"
                , attribute "aria-label" ("Structured message: " ++ Maybe.withDefault "details" block.title)
                , attribute "data-testid" "blockkit-card"
                ]
                [ div [ class "bk-modal-row" ]
                    [ span [ class "bk-modal-copy" ]
                        [ strong [ class "bk-title" ] [ text (Maybe.withDefault "Details" block.title) ]
                        , case block.text of
                            Just t ->
                                span [ class "bk-text bk-text--clip" ] [ text t ]

                            Nothing ->
                                text ""
                        ]
                    , button
                        [ type_ "button"
                        , class "bk-btn bk-btn--action"
                        , id openerId
                        , attribute "data-testid" "blockkit-open"
                        , onClick (msg (BK.OpenInspect { origin = env.target, key = env.key, block = block, openerId = openerId }))
                        ]
                        [ text trigger ]
                    ]
                ]

        BK.MessageBlock ->
            let
                interactive =
                    not (List.isEmpty block.buttons && List.isEmpty block.selects)

                inspectId =
                    BK.controlId env.key "inspect"
            in
            div
                [ class "bk-card"
                , attribute "role" "group"
                , attribute "aria-label" ("Structured message" ++ Maybe.withDefault "" (Maybe.map (\t -> ": " ++ t) block.title))
                , attribute "data-testid" "blockkit-card"
                ]
                (List.filterMap identity
                    [ Maybe.map (\t -> h4 [ class "bk-title" ] [ text t ]) block.title
                    , Maybe.map (\t -> p [ class "bk-text" ] [ text t ]) block.text
                    , fieldsView block.fields
                    , selectsView model env block.selects
                    , buttonsView model env block.buttons
                    , if interactive then
                        Just
                            (div [ class "bk-foot" ]
                                [ if offOrigin env block then
                                    span [ class "bk-note" ] [ text "Some controls belong to another conversation and can't run here." ]

                                  else
                                    text ""
                                , button
                                    [ type_ "button"
                                    , class "bk-inspect"
                                    , id inspectId
                                    , attribute "data-testid" "blockkit-inspect"
                                    , onClick (msg (BK.OpenInspect { origin = env.target, key = env.key, block = block, openerId = inspectId }))
                                    ]
                                    [ text "Inspect structured data" ]
                                ]
                            )

                      else
                        Nothing
                    ]
                )


{-| Whether any control in the block targets another conversation. -}
offOrigin : Env -> BK.Block -> Bool
offOrigin env block =
    List.any (\b -> not (BK.originAllows env.target b.action)) block.selects
        || List.any
            (\b ->
                case b.kind of
                    BK.RunAction action ->
                        not (BK.originAllows env.target action)

                    _ ->
                        False
            )
            block.buttons


fieldsView : List BK.Field -> Maybe (Html Msg)
fieldsView fields =
    if List.isEmpty fields then
        Nothing

    else
        Just
            (dl [ class "bk-fields" ]
                (List.map
                    (\f ->
                        div [ class "bk-field" ]
                            [ dt [] [ text f.label ]
                            , dd []
                                [ if String.isEmpty f.value then
                                    span [ class "bk-unset" ] [ text "Not set" ]

                                  else
                                    text f.value
                                ]
                            ]
                    )
                    fields
                )
            )


selectsView : Model -> Env -> List BK.Select -> Maybe (Html Msg)
selectsView model env selects =
    if List.isEmpty selects then
        Nothing

    else
        Just (div [ class "bk-selects" ] (List.indexedMap (selectView model env) selects))


selectView : Model -> Env -> Int -> BK.Select -> Html Msg
selectView model env i select =
    let
        selectId =
            BK.controlId env.key (env.prefix ++ "s" ++ String.fromInt i)

        allowed =
            BK.originAllows env.target select.action

        change =
            Decode.at [ "target", "value" ] Decode.string
                |> Decode.andThen
                    (\v ->
                        if String.isEmpty v then
                            Decode.fail "placeholder"

                        else
                            Decode.succeed (msg (BK.Stage { origin = env.target, action = select.action, selected = Just v, returnTo = selectId }))
                    )
    in
    Html.label [ class "bk-select" ]
        [ span [ class "bk-select-label" ] [ text select.label ]
        , Html.Keyed.node "span"
            [ class "bk-select-wrap" ]
            [ ( String.fromInt model.blockKit.stages
              , Html.select
                    [ id selectId
                    , class "bk-select-input"
                    , disabled (not allowed)
                    , attribute "aria-label" select.label
                    , title
                        (if allowed then
                            "Choose an option to review its message"

                         else
                            offOriginCopy
                        )
                    , on "change" change
                    ]
                    (Html.option [ Html.Attributes.value "" ] [ text "Choose…" ]
                        :: List.map (\o -> Html.option [ Html.Attributes.value o.value ] [ text o.label ]) select.options
                    )
              )
            ]
        ]


buttonsView : Model -> Env -> List BK.Button -> Maybe (Html Msg)
buttonsView model env buttons =
    if List.isEmpty buttons then
        Nothing

    else
        Just
            (div [ class "bk-actions", attribute "role" "group", attribute "aria-label" "Structured actions" ]
                (List.indexedMap (buttonView model env) buttons)
            )


offOriginCopy : String
offOriginCopy =
    "This control belongs to another conversation, so it cannot run here."


buttonView : Model -> Env -> Int -> BK.Button -> Html Msg
buttonView model env i button_ =
    let
        buttonId =
            BK.controlId env.key (env.prefix ++ "b" ++ String.fromInt i)
    in
    case button_.kind of
        BK.OpenUrl u ->
            a
                [ class "bk-btn bk-btn--link"
                , id buttonId
                , href u.href
                , target "_blank"
                , rel "noopener noreferrer"
                , title ("Opens " ++ u.href)
                , attribute "aria-label" (button_.label ++ ", opens " ++ u.host ++ " in a new tab")
                ]
                [ span [ class "bk-btn-label" ] [ text button_.label ]
                , span [ class "bk-host", attribute "aria-hidden" "true" ] [ text u.host ]
                ]

        BK.CopyValue value ->
            let
                copy =
                    BK.copyFor model.blockKit model.nowMs buttonId

                ( shown, state, announce ) =
                    case copy of
                        Just (BK.Copied _) ->
                            ( "Copied", "copied", button_.label ++ " value copied." )

                        Just (BK.CopyFailed _) ->
                            ( "Copy failed", "failed", button_.label ++ " value could not be copied." )

                        Nothing ->
                            ( button_.label, "idle", "" )
            in
            span [ class "bk-copy" ]
                [ button
                    [ type_ "button"
                    , class "bk-btn"
                    , id buttonId
                    , attribute "data-copy-state" state
                    , attribute "aria-label" ("Copy value for " ++ button_.label)
                    , title "Copy this value"
                    , onClick (msg (BK.CopyClicked { key = buttonId, value = value }))
                    ]
                    [ text shown ]
                , span [ class "sr-only", attribute "role" "status", attribute "aria-live" "polite" ] [ text announce ]
                ]

        BK.RunAction action ->
            let
                allowed =
                    BK.originAllows env.target action
            in
            button
                [ type_ "button"
                , class "bk-btn bk-btn--action"
                , id buttonId
                , disabled (not allowed)
                , title
                    (if allowed then
                        "Review this action before sending"

                     else
                        offOriginCopy
                    )
                , onClick (msg (BK.Stage { origin = env.target, action = action, selected = Nothing, returnTo = buttonId }))
                ]
                [ text button_.label ]



-- DIALOGS


overlay : Model -> Html Msg
overlay model =
    case ( model.blockKit.review, model.blockKit.inspect ) of
        ( Just review, _ ) ->
            reviewDialog review

        ( Nothing, Just inspect ) ->
            inspectDialog model inspect

        _ ->
            text ""


reviewDialog : BK.Review -> Html Msg
reviewDialog review =
    Sheet.view
        { scope = "blockkit-review"
        , label = Sheet.LabelledBy "blockkit-review-title"
        , onClose = msg BK.CancelReview
        , placement = Sheet.Center
        , layerClass = "bk-layer"
        , panelClass = "bk-dialog"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "aria-describedby" "blockkit-review-desc", attribute "data-testid" "blockkit-review" ]
        }
        [ Sheet.headerWith
            (Sheet.head { scope = "blockkit-review", title = "Send message from structured control?", closeLabel = "Cancel sending message", onClose = msg BK.CancelReview }
                |> (\h ->
                        { h
                            | titleId = Just "blockkit-review-title"
                            , kicker = Just "Action review"
                            , subtitle = Just "Review the exact destination and plaintext. Nothing is sent until you confirm."
                            , subtitleId = Just "blockkit-review-desc"
                        }
                   )
            )
        , div [ class "bk-dialog-body" ]
            [ dl [ class "bk-review" ]
                [ div []
                    [ dt [] [ text "Send to" ]
                    , dd [] [ code [ attribute "aria-label" ("Destination " ++ review.prepared.target) ] [ text review.prepared.target ] ]
                    ]
                , div []
                    [ dt [] [ text "Message" ]
                    , dd [] [ pre [ class "bk-review-text" ] [ text review.prepared.text ] ]
                    ]
                ]
            , p [ class "bk-warning" ] [ text "This message will be sent as you." ]
            , div [ class "bk-dialog-actions" ]
                [ button
                    [ type_ "button"
                    , class "hi-btn"
                    , Sheet.autofocus "blockkit-review"
                    , attribute "data-testid" "blockkit-cancel"
                    , onClick (msg BK.CancelReview)
                    ]
                    [ text "Cancel" ]
                , button
                    [ type_ "button"
                    , class "hi-btn hi-btn--primary"
                    , attribute "data-testid" "blockkit-send"
                    , onClick (msg BK.ConfirmSend)
                    ]
                    [ text "Send message" ]
                ]
            ]
        ]


inspectDialog : Model -> { origin : String, key : String, block : BK.Block, openerId : String } -> Html Msg
inspectDialog model i =
    let
        env =
            { target = i.origin, key = i.key, prefix = "m" }

        block =
            i.block

        titleText =
            Maybe.withDefault "Structured data" block.title
    in
    Sheet.view
        { scope = "blockkit-inspect"
        , label = Sheet.LabelledBy "blockkit-inspect-title"
        , onClose = msg BK.CloseInspect
        , placement = Sheet.Center
        , layerClass = "bk-layer"
        , panelClass = "bk-dialog bk-dialog--inspect"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "aria-describedby" "blockkit-inspect-desc", attribute "data-testid" "blockkit-inspect-dialog" ]
        }
        [ Sheet.headerWith
            (Sheet.head { scope = "blockkit-inspect", title = titleText, closeLabel = "Close structured data", onClose = msg BK.CloseInspect }
                |> (\h ->
                        { h
                            | titleId = Just "blockkit-inspect-title"
                            , kicker = Just "Inspect structured data"
                            , subtitle = block.text
                            , subtitleId = Just "blockkit-inspect-desc"
                        }
                   )
            )
        , div [ class "bk-dialog-body" ]
            ([ p [ class "bk-intro", Sheet.autofocus "blockkit-inspect", Html.Attributes.tabindex -1 ]
                [ text ("Posted in " ++ i.origin ++ ". Review the fields and destinations below. Actions open a separate confirmation before anything is sent.") ]
             ]
                ++ List.filterMap identity
                    [ if List.isEmpty block.fields then
                        Nothing

                      else
                        Just
                            (div [ class "bk-section" ]
                                [ h3 [ class "bk-section-title" ] [ text "Fields" ]
                                , Maybe.withDefault (text "") (fieldsView block.fields)
                                ]
                            )
                    , if List.isEmpty block.selects then
                        Nothing

                      else
                        Just
                            (div [ class "bk-section" ]
                                (h3 [ class "bk-section-title" ] [ text "Choices" ]
                                    :: List.indexedMap (inspectSelect model env) block.selects
                                )
                            )
                    , if List.isEmpty block.buttons then
                        Nothing

                      else
                        Just
                            (div [ class "bk-section" ]
                                (h3 [ class "bk-section-title" ] [ text "Buttons" ]
                                    :: List.indexedMap (inspectButton model env) block.buttons
                                )
                            )
                    ]
            )
        ]


inspectSelect : Model -> Env -> Int -> BK.Select -> Html Msg
inspectSelect model env i select =
    div [ class "bk-detail" ]
        [ selectView model env i select
        , ul [ class "bk-detail-list" ]
            (List.map
                (\o ->
                    li []
                        [ span [ class "bk-detail-label" ] [ text o.label ]
                        , span [ class "bk-detail-what" ]
                            [ text
                                (case BK.prepare env.target select.action (Just o.value) of
                                    Just p ->
                                        "Sends “" ++ p.text ++ "” to " ++ p.target

                                    Nothing ->
                                        offOriginCopy
                                )
                            ]
                        ]
                )
                select.options
            )
        ]


inspectButton : Model -> Env -> Int -> BK.Button -> Html Msg
inspectButton model env i button_ =
    div [ class "bk-detail" ]
        [ buttonView model env i button_
        , p [ class "bk-detail-what" ]
            [ text
                (case button_.kind of
                    BK.OpenUrl u ->
                        "Opens " ++ u.href

                    BK.CopyValue v ->
                        "Copies “" ++ v ++ "”"

                    BK.RunAction action ->
                        case BK.prepare env.target action Nothing of
                            Just p ->
                                "Sends “" ++ p.text ++ "” to " ++ p.target

                            Nothing ->
                                offOriginCopy
                )
            ]
        ]
