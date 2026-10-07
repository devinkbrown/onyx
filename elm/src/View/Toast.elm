module View.Toast exposing (toaster)

{-| Toast region — the `aria-live="polite"` notification list mirroring
`primitives/Toast.tsx` (`ol.onyx-toaster`, per-row
`li.onyx-toast.onyx-toast--<intent>`, `role="alert"` for danger rows and
`role="status"` otherwise, title + optional description, dismiss button
with `Dismiss <title>` label).

Variant-to-intent collapsing lives in `App.toastIntent` next to the
fold; the undo control replays the stored `ToastUndo` action through
`ToastUndoFired` (block/unblock a nick, mirroring the oracle's `undoAction`
closures in `IgnoredUsersControl.tsx`). Auto-dismiss is Tick-driven in
the fold — the view carries no timers.
-}

import App exposing (Model, Msg(..), Toast, toastIntent)
import Html exposing (Html, button, div, li, ol, p, strong, text)
import Html.Attributes exposing (attribute, class)
import Html.Events exposing (onClick)


toaster : Model -> Html Msg
toaster model =
    ol
        [ class "onyx-toaster"
        , attribute "aria-live" "polite"
        , attribute "aria-label" "Notifications"
        ]
        (List.map toastRow model.toasts)


toastRow : Toast -> Html Msg
toastRow toast =
    let
        intent =
            toastIntent toast.variant
    in
    li
        [ class ("onyx-toast onyx-toast--" ++ intent)
        , attribute "role"
            (if intent == "danger" then
                "alert"

             else
                "status"
            )
        ]
        [ div [ class "onyx-toast__body" ]
            ([ strong [] [ text toast.title ] ]
                ++ (case toast.description of
                        Just description ->
                            [ p [] [ text description ] ]

                        Nothing ->
                            []
                   )
            )
        , case toast.undo of
            Just _ ->
                button
                    [ attribute "type" "button"
                    , class "onyx-toast__undo"
                    , onClick (ToastUndoFired toast.id)
                    ]
                    [ text "Undo" ]

            Nothing ->
                text ""
        , button
            [ attribute "type" "button"
            , class "onyx-toast__dismiss"
            , attribute "aria-label" ("Dismiss " ++ toast.title)
            , onClick (ToastDismiss toast.id)
            ]
            [ text "×" ]
        ]
