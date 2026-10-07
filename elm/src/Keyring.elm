module Keyring exposing
    ( InstallResult(..)
    , KeyRef
    , Keyring
    , activate
    , activeEpoch
    , blankKeyring
    , clearRoom
    , getActive
    , getEpochKey
    , install
    , maxRoomEpochs
    , maxRoomNameBytes
    , normalizeGroupRoom
    , roomEpochCount
    , validAuthenticatedId
    , validRoomEpoch
    )

{-| Ephemeral room-epoch key storage — Elm port of
`lib/e2ee/groupKeyring.ts`.

Keys stay opaque: Elm never sees key bytes, only `KeyRef` handles
minted by the WebCrypto port (which also enforces the oracle's key
shape — secret, AES-GCM, non-extractable, encrypt+decrypt usages).
Elm owns every fail-closed rule around them:

  - conflicting keys for a known epoch are rejected, never replaced;
  - the active seal epoch only advances (first install or a higher
    epoch), never demotes on lower installs;
  - at most 8 epochs per room, lowest evicted first; an evicted active
    epoch re-points at the highest retained one;
  - room secrets are never serialized — this structure lives in memory
    only (the vault stores `ONYXROOM1` ciphertext alone).

Epoch divergence (shared with `GroupControl.validControlEpoch`): Elm
`Int` is 32-bit, so epochs past 2^31-1 are rejected here while the
oracle accepts the full u32. Epochs increment from small values.

-}

import Base64Url
import Dict exposing (Dict)


maxRoomEpochs : Int
maxRoomEpochs =
    8


maxRoomNameBytes : Int
maxRoomNameBytes =
    256


{-| Opaque handle for a WebCrypto epoch key. Minted by the crypto port;
Elm only compares and stores it.
-}
type alias KeyRef =
    String


type alias EpochEntry =
    { key : KeyRef
    , authenticatedId : String
    }


type alias RoomState =
    { epochs : Dict Int EpochEntry
    , activeEpoch : Maybe Int
    }


type alias Keyring =
    Dict String RoomState


type InstallResult
    = Installed
    | Unchanged
    | Conflict
    | Invalid


blankKeyring : Keyring
blankKeyring =
    Dict.empty


{-| Canonical room name for keyring lookup and AAD binding:
trim + lowercase; reject empty and oversized names.
-}
normalizeGroupRoom : String -> Maybe String
normalizeGroupRoom room =
    let
        normalized =
            String.toLower (String.trim room)
    in
    if String.isEmpty normalized then
        Nothing

    else if Base64Url.utf8ByteLength normalized > maxRoomNameBytes then
        Nothing

    else
        Just normalized


validRoomEpoch : Int -> Bool
validRoomEpoch epoch =
    epoch >= 0


validAuthenticatedId : String -> Bool
validAuthenticatedId value =
    let
        ok c =
            Char.isAlphaNum c || c == '_' || c == '-'
    in
    not (String.isEmpty value)
        && String.length value <= 128
        && String.all ok value


install : Keyring -> String -> Int -> KeyRef -> String -> ( Keyring, InstallResult )
install keyring room epoch key authenticatedId =
    case normalizeGroupRoom room of
        Nothing ->
            ( keyring, Invalid )

        Just normalized ->
            if not (validRoomEpoch epoch) then
                ( keyring, Invalid )

            else if String.isEmpty key || not (validAuthenticatedId authenticatedId) then
                ( keyring, Invalid )

            else
                let
                    state =
                        Maybe.withDefault { epochs = Dict.empty, activeEpoch = Nothing }
                            (Dict.get normalized keyring)
                in
                case Dict.get epoch state.epochs of
                    Just existing ->
                        if existing.authenticatedId == authenticatedId then
                            ( keyring, Unchanged )

                        else
                            ( keyring, Conflict )

                    Nothing ->
                        let
                            kept =
                                evictLowest (Dict.insert epoch { key = key, authenticatedId = authenticatedId } state.epochs)

                            promoted =
                                if state.activeEpoch == Nothing || not (Dict.member (Maybe.withDefault -1 state.activeEpoch) kept) || epoch > Maybe.withDefault -1 state.activeEpoch then
                                    if Dict.member epoch kept then
                                        Just epoch

                                    else
                                        highestEpoch kept

                                else
                                    state.activeEpoch

                            active =
                                case promoted of
                                    Just a ->
                                        if Dict.member a kept then
                                            Just a

                                        else
                                            highestEpoch kept

                                    Nothing ->
                                        highestEpoch kept
                        in
                        ( Dict.insert normalized { epochs = kept, activeEpoch = active } keyring
                        , Installed
                        )


evictLowest : Dict Int EpochEntry -> Dict Int EpochEntry
evictLowest epochs =
    if Dict.size epochs > maxRoomEpochs then
        case List.head (Dict.keys epochs) of
            Just lowest ->
                Dict.remove lowest epochs

            Nothing ->
                epochs

    else
        epochs


highestEpoch : Dict Int EpochEntry -> Maybe Int
highestEpoch epochs =
    List.maximum (Dict.keys epochs)


getEpochKey : Keyring -> String -> Int -> Maybe KeyRef
getEpochKey keyring room epoch =
    case normalizeGroupRoom room of
        Nothing ->
            Nothing

        Just normalized ->
            if not (validRoomEpoch epoch) then
                Nothing

            else
                Dict.get normalized keyring
                    |> Maybe.andThen (\state -> Dict.get epoch state.epochs)
                    |> Maybe.map .key


activeEpoch : Keyring -> String -> Maybe Int
activeEpoch keyring room =
    case normalizeGroupRoom room of
        Nothing ->
            Nothing

        Just normalized ->
            Maybe.andThen .activeEpoch (Dict.get normalized keyring)


getActive : Keyring -> String -> Maybe KeyRef
getActive keyring room =
    case normalizeGroupRoom room of
        Nothing ->
            Nothing

        Just normalized ->
            case Dict.get normalized keyring of
                Nothing ->
                    Nothing

                Just state ->
                    case state.activeEpoch of
                        Nothing ->
                            Nothing

                        Just epoch ->
                            Maybe.map .key (Dict.get epoch state.epochs)


{-| Explicitly select a retained epoch for local seal. False when the
room/epoch is missing or invalid.
-}
activate : Keyring -> String -> Int -> ( Keyring, Bool )
activate keyring room epoch =
    case normalizeGroupRoom room of
        Nothing ->
            ( keyring, False )

        Just normalized ->
            if not (validRoomEpoch epoch) then
                ( keyring, False )

            else
                case Dict.get normalized keyring of
                    Nothing ->
                        ( keyring, False )

                    Just state ->
                        if Dict.member epoch state.epochs then
                            ( Dict.insert normalized { state | activeEpoch = Just epoch } keyring
                            , True
                            )

                        else
                            ( keyring, False )


clearRoom : Keyring -> String -> Keyring
clearRoom keyring room =
    case normalizeGroupRoom room of
        Nothing ->
            keyring

        Just normalized ->
            Dict.remove normalized keyring


roomEpochCount : Keyring -> String -> Int
roomEpochCount keyring room =
    case normalizeGroupRoom room of
        Nothing ->
            0

        Just normalized ->
            Dict.get normalized keyring
                |> Maybe.map (\state -> Dict.size state.epochs)
                |> Maybe.withDefault 0
