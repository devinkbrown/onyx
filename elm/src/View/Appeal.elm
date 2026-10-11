module View.Appeal exposing (appealButton, appealSheet)

{-| v3/gap-oper — "Ask for a second look": the person's side of
`APPEAL`. The daemon files one appeal per host per hour and accepts it
even before registration, which is exactly when a banned person needs
it, so the form works two ways, through one sheet:

  - on the connect screen, a quiet footer button (`appealButton`) opens
    the sheet — nobody is connected yet, so the appeal is saved and goes
    out first thing on the next connection the Connect button opens;
  - inside the app, `/appeal` opens the same sheet (`appealSheet`) and
    the appeal is sent at once over the live session.

The copy is honest about what the server does: the appeal is recorded
for the operators; nothing writes back to you.

-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Html exposing (Html, button, div, form, p, text, textarea)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, placeholder, rows, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import OperConsole as C exposing (UserAppeal(..))
import OperPlan
import View.Sheet as Sheet


appealSheet : Model -> Html Msg
appealSheet model =
    if model.operConsole.userAppealOpen then
        Sheet.view
            { scope = "appeal"
            , label = Sheet.LabelledBy "appeal-title"
            , onClose = OperConsoleMsg C.CloseUserAppeal
            , placement = Sheet.Center
            , layerClass = "ap-layer"
            , panelClass = "ap-sheet"
            , backdropClass = "ap-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "appeal-sheet" ]
            }
            [ Sheet.headerWith
                (Sheet.head { scope = "appeal", title = "Ask for a second look", closeLabel = "Close appeal", onClose = OperConsoleMsg C.CloseUserAppeal }
                    |> (\h -> { h | titleId = Just "appeal-title", kicker = Just "Appeal" })
                )
            , appealForm model "appeal"
            ]

    else
        text ""


{-| The connect-screen entry: a footer button beside About / Privacy. -}
appealButton : Html Msg
appealButton =
    button
        [ type_ "button"
        , class "ap-footlink"
        , attribute "data-testid" "appeal-open"
        , onClick (OperConsoleMsg C.OpenUserAppeal)
        ]
        [ text "Appeal a ban" ]


appealForm : Model -> String -> Html Msg
appealForm model scope =
    let
        console =
            model.operConsole

        text_ =
            console.forms.appealText

        busy =
            console.userAppeal == AppealSending

        fieldId =
            "appeal-text-" ++ scope

        live =
            model.connection == Live
    in
    form [ class "ap-form", attribute "data-testid" ("appeal-form-" ++ scope), onSubmit (OperConsoleMsg C.SendUserAppeal) ]
        [ p [ class "ap-lede" ]
            [ text "If you were banned, muted or blocked and think it was a mistake, tell the operators what happened. The network takes one appeal an hour. Operators read them in turn; nothing is sent back to you, so connect again later to see if the restriction is gone." ]
        , div [ class "ap-field" ]
            [ Html.label [ for fieldId ] [ text "What happened?" ]
            , textarea
                [ id fieldId
                , class "ap-input"
                , rows 4
                , maxlength OperPlan.maxAppealLength
                , value text_
                , placeholder "I was banned while sharing a connection with my brother. We are two people."
                , attribute "data-testid" ("appeal-text-" ++ scope)
                , attribute "aria-describedby" (fieldId ++ "-count")
                , Sheet.autofocus "appeal"
                , onInput (\v -> OperConsoleMsg (C.Edit C.AppealText v))
                ]
                []
            , p [ id (fieldId ++ "-count"), class "ap-hint" ]
                [ text (String.fromInt (String.length text_) ++ " of " ++ String.fromInt OperPlan.maxAppealLength ++ " characters") ]
            ]
        , statusLine live console.userAppeal
        , div [ class "ap-actions" ]
            [ button
                [ type_ "submit"
                , class "ap-btn"
                , disabled (busy || String.trim text_ == "" || console.userAppeal == AppealQueued)
                , attribute "data-testid" ("appeal-submit-" ++ scope)
                ]
                [ text
                    (if live then
                        "File appeal"

                     else
                        "Save appeal"
                    )
                ]
            ]
        ]


statusLine : Bool -> UserAppeal -> Html Msg
statusLine live status =
    case status of
        AppealIdle ->
            text ""

        AppealQueued ->
            p [ class "ap-status", attribute "role" "status", attribute "data-testid" "appeal-status" ]
                [ text
                    (if live then
                        "Saved."

                     else
                        "Saved. It is sent first thing when a connection opens — press Connect (or wait for the reconnect)."
                    )
                ]

        AppealSending ->
            p [ class "ap-status", attribute "role" "status", attribute "data-testid" "appeal-status" ] [ text "Sending…" ]

        AppealFiledAs id ->
            p [ class "ap-status ap-status-good", attribute "role" "status", attribute "data-testid" "appeal-status" ]
                [ text ("Appeal " ++ String.fromInt id ++ " is filed. The operators will read it; there is no automatic reply.") ]

        AppealRefused reason ->
            p [ class "ap-status ap-status-bad", attribute "role" "alert", attribute "data-testid" "appeal-status" ] [ text reason ]
