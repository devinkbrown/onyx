module View.CallSetup exposing (snapshotView, view)

import Html exposing (Html, button, div, h2, label, p, text)
import Html.Attributes exposing (attribute, class, disabled, type_)
import Html.Events exposing (onClick)
import MediaReadiness exposing (DeviceState(..), Model, Msg(..), Phase(..))
import RuntimeDomain


snapshotView : Maybe RuntimeDomain.MediaControlView -> Html msg
snapshotView snapshot =
    div [ class "onyx-call-setup", attribute "aria-label" "Observed media setup" ]
        [ h2 [] [ text "Observed media setup" ]
        , case snapshot of
            Just media ->
                div []
                    [ p [ attribute "role" "status" ] [ text ("Media runtime state: " ++ media.state ++ Maybe.withDefault "" (Maybe.map ((++) ". ") media.reason)) ]
                    , p [] [ text ("Microphone switch: " ++ media.devices.inputState ++ "; speaker selection: " ++ media.devices.outputState) ]
                    , p []
                        [ text
                            (case media.call of
                                Just call ->
                                    "Current call: " ++ call.conversationId ++ "."

                                Nothing ->
                                    "No current call reported."
                            )
                        ]
                    ]
            Nothing ->
                p [ attribute "role" "status" ] [ text "Device and call readiness is not available from the runtime." ]
        ]


view : Model -> String -> Html Msg
view model requestId =
    let
        ( heading, detail, canJoin ) =
            case model.phase of
                Unsupported -> ( "Calls unavailable", "This browser does not provide the required media features.", False )
                NeedsPermission -> ( "Set up your call", "Choose your microphone and test input before joining.", True )
                Checking -> ( "Checking media", "Waiting for the browser media check to finish.", False )
                Ready -> ( "Ready to call", "Your selected devices are ready.", True )
                InCall _ _ -> ( "Call in progress", "Your call is connected.", False )
                Degraded reason -> ( "Call needs attention", reason, True )
                Failed reason -> ( "Call could not start", reason, True )

        deviceText device =
            case device of
                DeviceUnknown -> "Device status unavailable"
                DeviceAvailable -> "Device ready"
                DeviceMissing -> "No device found"
                DeviceDenied -> "Permission denied"
    in
    div [ class "onyx-call-setup", attribute "aria-labelledby" "onyx-call-setup-title" ]
        [ h2 [ attribute "id" "onyx-call-setup-title" ] [ text heading ]
        , p [ attribute "role" "status", attribute "aria-live" "polite" ] [ text detail ]
        , label [] [ text ("Microphone: " ++ deviceText model.input) ]
        , label [] [ text ("Speaker: " ++ deviceText model.output) ]
        , button [ type_ "button", disabled (not canJoin || String.isEmpty requestId), onClick (JoinRequested requestId "" "voice") ] [ text "Join voice" ]
        , button [ type_ "button", onClick (SoundcheckRequested requestId) ] [ text "Check microphone input" ]
        , button [ type_ "button", onClick (MuteChanged (not model.muted)), attribute "aria-pressed" (if model.muted then "true" else "false") ] [ text (if model.muted then "Unmute" else "Mute") ]
        , button [ type_ "button", onClick (DeafenChanged (not model.deafened)), attribute "aria-pressed" (if model.deafened then "true" else "false") ] [ text (if model.deafened then "Undeafen" else "Deafen") ]
        ]
