/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React, { useEffect } from 'react';
import {
    Box,
    Button,
    ButtonGroup,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Skeleton,
    Step,
    StepLabel,
    Stepper,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Grid from '@mui/material/Grid';
import { useTranslation } from 'react-i18next';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import { useDispatch, useSelector } from 'react-redux';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { getMaidenhead } from '../common/common.jsx';
import { useSocket } from '../common/socket.jsx';
import { getTileLayerById } from '../common/tile-layers.jsx';
import {
    SettingsActionFooter,
    SettingsSection,
    SettingsSurface,
    SettingsSurfaceHeader,
} from './shared/index.js';
import {
    setAltitude,
    setLocation,
    setLocationId,
    setLocationLoading,
    setPolylines,
    setQth,
    storeLocation,
} from './location-slice.jsx';

const createCustomIcon = () => {
    const svgIcon = `
        <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="dropshadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                    <feOffset dx="3" dy="5" result="offset"/>
                    <feFlood flood-color="#000000" flood-opacity="0.6"/>
                    <feComposite in2="offset" operator="in"/>
                    <feMerge>
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <path d="M12.5 0C5.597 0 0 5.597 0 12.5c0 12.5 12.5 28.5 12.5 28.5s12.5-16 12.5-28.5C25 5.597 19.403 0 12.5 0z"
                  fill="#3388ff"
                  filter="url(#dropshadow)"/>
            <circle cx="12.5" cy="12.5" r="5" fill="white"/>
        </svg>
    `;

    return L.icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(svgIcon)}`,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: null,
        shadowSize: null,
        shadowAnchor: null,
    });
};

const setupMarkerIcons = () => {
    try {
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        });
    } catch (error) {
        console.warn('Failed to set up default marker icons:', error);
    }
};

setupMarkerIcons();
const customIcon = createCustomIcon();

const locationCardSx = {
    backgroundColor: (theme) => (
        theme.palette.mode === 'dark'
            ? alpha(theme.palette.grey[700], 0.18)
            : alpha(theme.palette.grey[100], 0.9)
    ),
};

function MapClickHandler({ onClick }) {
    useMapEvents({ click: onClick });
    return null;
}

const normalizeStationName = (value) => String(value || '').trim();
const normalizeCallsign = (value) => String(value || '').trim().toUpperCase();
const WIZARD_STEP_IDENTITY = 0;
const WIZARD_STEP_COORDINATES = 1;
const WIZARD_STEP_REVIEW = 2;

const LocationPage = ({ wizardMode = false, onWizardCompleted = null }) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('settings');

    const [nearestCity, setNearestCity] = React.useState(null);
    const [cityLoading, setCityLoading] = React.useState(false);
    const [elevationLoading, setElevationLoading] = React.useState(false);
    const [savedState, setSavedState] = React.useState(null);
    const [manualDialogOpen, setManualDialogOpen] = React.useState(false);
    const [manualLatInput, setManualLatInput] = React.useState('');
    const [manualLonInput, setManualLonInput] = React.useState('');
    const [manualInputError, setManualInputError] = React.useState('');
    const [wizardStep, setWizardStep] = React.useState(WIZARD_STEP_IDENTITY);
    const mapRef = React.useRef(null);

    const {
        locationLoading,
        locationSaving,
        location,
        locationId,
        qth,
        polylines,
        altitude,
    } = useSelector((state) => state.location);

    const hasLocation = location && location.lat != null && location.lon != null;
    const stationName = location?.name || '';
    const stationCallsign = location?.callsign || '';
    const stationLabel = normalizeStationName(stationName) || 'home';
    const stationCallsignLabel = normalizeCallsign(stationCallsign);
    const normalizedLocation = React.useMemo(() => {
        if (!hasLocation) return null;
        return { lat: Number(location.lat), lon: Number(location.lon) };
    }, [hasLocation, location?.lat, location?.lon]);
    const updateLocationState = React.useCallback((patch) => {
        dispatch(setLocation({ ...(location || {}), ...patch }));
    }, [dispatch, location]);

    const getNearestCity = async (lat, lon) => {
        try {
            const response = await fetch(
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
            );
            const data = await response.json();
            return data.city || data.locality || data.principalSubdivision || 'Unknown';
        } catch (error) {
            console.error('Error fetching city:', error);
            return null;
        }
    };

    const getElevation = async (lat, lon) => {
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`);
        const data = await response.json();
        return data.results[0].elevation;
    };

    const reCenterMap = (lat, lon) => {
        if (mapRef.current) {
            mapRef.current.setView([lat, lon], mapRef.current.getZoom());
        }
    };

    const handleWhenReady = (map) => {
        mapRef.current = map.target;
    };

    useEffect(() => {
        if (!hasLocation) {
            setNearestCity(null);
            setCityLoading(false);
            return;
        }

        setCityLoading(true);
        getNearestCity(normalizedLocation.lat, normalizedLocation.lon)
            .then((city) => setNearestCity(city))
            .finally(() => setCityLoading(false));
    }, [hasLocation, normalizedLocation]);

    useEffect(() => {
        if (!hasLocation) {
            dispatch(setPolylines([]));
            return;
        }

        const horizontalLine = [[normalizedLocation.lat, -270], [normalizedLocation.lat, 270]];
        const verticalLine = [[-90, normalizedLocation.lon], [90, normalizedLocation.lon]];
        dispatch(setPolylines([horizontalLine, verticalLine]));
        dispatch(setQth(getMaidenhead(normalizedLocation.lat, normalizedLocation.lon)));
    }, [dispatch, hasLocation, normalizedLocation]);

    useEffect(() => {
        if (mapRef.current && hasLocation) {
            mapRef.current.invalidateSize();
            reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
        }
    }, [hasLocation, normalizedLocation]);

    useEffect(() => {
        // Initialize the "saved baseline" only from backend-loaded locations.
        // When the user selects a new point on the map for the first time, it should remain unsaved.
        if (!savedState && hasLocation && locationId != null) {
            setSavedState({
                lat: Number(location.lat),
                lon: Number(location.lon),
                altitude: Number(altitude || 0),
                name: normalizeStationName(location.name || 'home'),
                callsign: normalizeCallsign(location.callsign || ''),
                locationId: locationId || null,
            });
        }
    }, [savedState, hasLocation, location, altitude, locationId]);

    const isDifferentFromSaved = React.useMemo(() => {
        if (!hasLocation) return false;
        if (!savedState) return true;

        const latChanged = Math.abs(Number(location.lat) - savedState.lat) > 1e-7;
        const lonChanged = Math.abs(Number(location.lon) - savedState.lon) > 1e-7;
        const altitudeChanged = Number(altitude || 0) !== Number(savedState.altitude || 0);
        const nameChanged = normalizeStationName(location.name || 'home') !== normalizeStationName(savedState.name || 'home');
        const callsignChanged = normalizeCallsign(location.callsign || '') !== normalizeCallsign(savedState.callsign || '');
        const locationIdChanged = (locationId || null) !== (savedState.locationId || null);

        return latChanged || lonChanged || altitudeChanged || nameChanged || callsignChanged || locationIdChanged;
    }, [hasLocation, savedState, location, altitude, locationId]);

    const canSave = hasLocation && !locationSaving;
    const canReset = Boolean(savedState) && isDifferentFromSaved && !locationSaving && !locationLoading;

    const statusLabel = (() => {
        if (!hasLocation) {
            return t('location.state_no_location', { defaultValue: 'No location selected' });
        }
        if (locationSaving) {
            return t('location.state_saving', { defaultValue: 'Saving...' });
        }
        if (locationLoading) {
            return t('location.state_locating', { defaultValue: 'Locating...' });
        }
        if (isDifferentFromSaved) {
            return t('location.state_unsaved', { defaultValue: 'Unsaved changes' });
        }
        return t('location.state_saved', { defaultValue: 'Saved' });
    })();

    const statusColor = (() => {
        if (!hasLocation) return 'warning';
        if (locationSaving || locationLoading) return 'info';
        if (isDifferentFromSaved) return 'warning';
        return 'success';
    })();

    const nearestCityText = cityLoading
        ? t('location.state_resolving', { defaultValue: 'Resolving...' })
        : (nearestCity || t('location.state_unavailable', { defaultValue: 'Unavailable' }));

    const elevationText = elevationLoading
        ? t('location.state_resolving', { defaultValue: 'Resolving...' })
        : (hasLocation
            ? t('location.altitude_asl', { altitude })
            : t('location.state_unavailable', { defaultValue: 'Unavailable' }));

    const timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || t('location.state_unavailable', { defaultValue: 'Unavailable' });
    const tzOffsetHours = -new Date().getTimezoneOffset() / 60;
    const tzSign = tzOffsetHours >= 0 ? '+' : '-';
    const tzOffsetDisplay = `UTC${tzSign}${Math.abs(tzOffsetHours)}`;

    const mapCenter = hasLocation ? [normalizedLocation.lat, normalizedLocation.lon] : [20, 0];
    const mapZoom = hasLocation ? 5 : 2;
    const wizardSteps = [
        t('location.wizard_step_identity', { defaultValue: 'Station Identity' }),
        t('location.wizard_step_coordinates', { defaultValue: 'Coordinates & Map' }),
        t('location.wizard_step_review', { defaultValue: 'Review & Save' }),
    ];
    const isWizardLastStep = wizardStep === WIZARD_STEP_REVIEW;
    const canAdvanceWizard = wizardStep !== WIZARD_STEP_COORDINATES || hasLocation;

    const handleMapClick = async (e) => {
        const { lat, lng } = e.latlng;
        updateLocationState({ lat, lon: lng });
        dispatch(setQth(getMaidenhead(lat, lng)));
        reCenterMap(lat, lng);

        setCityLoading(true);
        const city = await getNearestCity(lat, lng);
        setNearestCity(city);
        setCityLoading(false);
    };

    const getCurrentLocation = async () => {
        dispatch(setLocationLoading(true));

        if (!navigator.geolocation) {
            toast.warning(t('location.geolocation_not_supported'));
            dispatch(setLocationLoading(false));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude, altitude: geoAltitude } = position.coords;

                updateLocationState({ lat: latitude, lon: longitude });

                if (geoAltitude != null) {
                    dispatch(setAltitude(geoAltitude));
                } else {
                    setElevationLoading(true);
                    getElevation(latitude, longitude)
                        .then((elevation) => {
                            dispatch(setAltitude(elevation));
                        })
                        .catch((error) => {
                            console.error('Error fetching elevation:', error);
                            toast.warning(t('location.state_elevation_unavailable', { defaultValue: 'Could not resolve elevation from external service.' }));
                        })
                        .finally(() => {
                            setElevationLoading(false);
                        });
                }

                dispatch(setQth(getMaidenhead(latitude, longitude)));
                reCenterMap(latitude, longitude);
                dispatch(setLocationLoading(false));
                toast.success(t('location.location_retrieved'));
            },
            () => {
                toast.error(t('location.failed_get_location'));
                dispatch(setLocationLoading(false));
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 60000,
            }
        );
    };

    const handleCopyCoordinates = async () => {
        if (!hasLocation) return;

        try {
            await navigator.clipboard.writeText(`${normalizedLocation.lat.toFixed(6)}, ${normalizedLocation.lon.toFixed(6)}`);
            toast.success(t('location.coordinates_copied'));
        } catch (error) {
            toast.error(t('location.failed_copy'));
        }
    };

    const handleOpenManualCoordinatesDialog = () => {
        if (hasLocation) {
            setManualLatInput(normalizedLocation.lat.toFixed(6));
            setManualLonInput(normalizedLocation.lon.toFixed(6));
        } else {
            setManualLatInput('');
            setManualLonInput('');
        }
        setManualInputError('');
        setManualDialogOpen(true);
    };

    const handleCloseManualCoordinatesDialog = () => {
        setManualInputError('');
        setManualDialogOpen(false);
    };

    const handleApplyManualCoordinates = async () => {
        const parsedLat = Number.parseFloat(manualLatInput.trim());
        const parsedLon = Number.parseFloat(manualLonInput.trim());

        // Validate user-entered decimal coordinates before hydrating map/location state.
        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
            setManualInputError(t('location.manual_coordinates_invalid', {
                defaultValue: 'Enter valid numeric latitude and longitude values.',
            }));
            return;
        }

        if (parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
            setManualInputError(t('location.manual_coordinates_range_error', {
                defaultValue: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
            }));
            return;
        }

        updateLocationState({ lat: parsedLat, lon: parsedLon });
        dispatch(setQth(getMaidenhead(parsedLat, parsedLon)));
        reCenterMap(parsedLat, parsedLon);

        setManualLatInput(parsedLat.toFixed(6));
        setManualLonInput(parsedLon.toFixed(6));
        setManualInputError('');
        setManualDialogOpen(false);

        setCityLoading(true);
        const city = await getNearestCity(parsedLat, parsedLon);
        setNearestCity(city);
        setCityLoading(false);
    };

    const handleSetLocation = async () => {
        if (!canSave) return false;

        try {
            await dispatch(storeLocation({ socket, location, altitude, locationId })).unwrap();
            setSavedState({
                lat: Number(location.lat),
                lon: Number(location.lon),
                altitude: Number(altitude || 0),
                name: normalizeStationName(location.name || 'home'),
                callsign: normalizeCallsign(location.callsign || ''),
                locationId: locationId || null,
            });
            return true;
        } catch (error) {
            // Toast handled in slice
            return false;
        }
    };

    const handleResetLocation = () => {
        if (!savedState) return;

        dispatch(setLocation({
            ...(location || {}),
            lat: savedState.lat,
            lon: savedState.lon,
            name: savedState.name,
            callsign: savedState.callsign,
        }));
        dispatch(setAltitude(savedState.altitude));
        dispatch(setLocationId(savedState.locationId));
        dispatch(setQth(getMaidenhead(savedState.lat, savedState.lon)));
        reCenterMap(savedState.lat, savedState.lon);
    };

    const handleWizardNext = () => {
        if (!wizardMode || isWizardLastStep || !canAdvanceWizard) return;
        setWizardStep((currentStep) => currentStep + 1);
    };

    const handleWizardBack = () => {
        if (!wizardMode || wizardStep === WIZARD_STEP_IDENTITY) return;
        setWizardStep((currentStep) => currentStep - 1);
    };

    const handleWizardSave = async () => {
        const saveSucceeded = await handleSetLocation();
        if (saveSucceeded && wizardMode && typeof onWizardCompleted === 'function') {
            onWizardCompleted();
        }
    };

    const stationIdentitySection = (
        <SettingsSection
            title={t('location.group_station_identity', { defaultValue: 'Station Identity' })}
            description={t('location.group_station_identity_help', {
                defaultValue: 'Name and HAM callsign used for this ground station location.',
            })}
            sx={locationCardSx}
        >
            <Grid container spacing={2} columns={12}>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.station_name', { defaultValue: 'Station Name' })}
                        value={stationName}
                        onChange={(event) => {
                            updateLocationState({ name: event.target.value });
                        }}
                        disabled={locationSaving}
                        fullWidth
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.ham_callsign', { defaultValue: 'HAM Callsign' })}
                        value={stationCallsign}
                        onChange={(event) => {
                            updateLocationState({ callsign: event.target.value.toUpperCase() });
                        }}
                        disabled={locationSaving}
                        fullWidth
                    />
                </Grid>
            </Grid>
        </SettingsSection>
    );

    const stationCoordinatesSection = (
        <SettingsSection
            title={t('location.group_station_coordinates', { defaultValue: 'Station Coordinates' })}
            description={t('location.group_station_details_help', {
                defaultValue: 'Coordinates and derived station metadata for the selected point.',
            })}
            sx={locationCardSx}
        >
            {locationLoading && !hasLocation ? (
                <Stack spacing={1}>
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                </Stack>
            ) : (
                <Grid container spacing={2} columns={12}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.latitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation ? `${normalizedLocation.lat.toFixed(6)}deg` : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.longitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation ? `${normalizedLocation.lon.toFixed(6)}deg` : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.qth_locator')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation ? (qth || 'N/A') : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.altitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {elevationText}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.timezone')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {`${timezoneName} (${tzOffsetDisplay})`}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.nearest_city')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {nearestCityText}
                        </Typography>
                    </Grid>
                </Grid>
            )}
        </SettingsSection>
    );

    const stationActionsSection = (
        <SettingsSection
            title={t('location.actions', { defaultValue: 'Actions' })}
            description={t('location.group_actions_help', {
                defaultValue: 'Quick tools for selecting and sharing station coordinates.',
            })}
            sx={locationCardSx}
        >
            <Stack spacing={1.2}>
                <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    disabled={locationLoading || locationSaving}
                    aria-label={t('location.get_current_location')}
                    onClick={getCurrentLocation}
                >
                    {locationLoading
                        ? t('location.state_locating', { defaultValue: 'Locating...' })
                        : t('location.get_current_location')}
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    disabled={locationLoading || locationSaving}
                    aria-label={t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                    onClick={handleOpenManualCoordinatesDialog}
                >
                    {t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    disabled={!hasLocation}
                    aria-label={t('location.copy_coordinates')}
                    onClick={handleCopyCoordinates}
                >
                    {t('location.copy_coordinates')}
                </Button>

                <Button
                    variant="outlined"
                    fullWidth
                    disabled={!hasLocation}
                    aria-label={t('location.map_recenter', { defaultValue: 'Recenter map' })}
                    onClick={() => {
                        if (hasLocation) reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
                    }}
                >
                    {t('location.map_recenter', { defaultValue: 'Recenter' })}
                </Button>

                {!hasLocation && (
                    <Typography variant="caption" color="warning.main">
                        {t('location.map_empty_hint', { defaultValue: 'No location selected yet. Click the map or use current location.' })}
                    </Typography>
                )}
            </Stack>
        </SettingsSection>
    );

    const mapSection = (
        <SettingsSection
            title={t('location.map_section_title', { defaultValue: 'Map Selection' })}
            description={t('location.map_instruction', {
                defaultValue: 'Click anywhere on the map to set your station coordinates.',
            })}
            sx={locationCardSx}
        >
            <Box
                sx={{
                    width: '100%',
                    height: { xs: 380, sm: 420, md: 500 },
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 1,
                }}
            >
                <MapContainer
                    center={mapCenter}
                    zoom={mapZoom}
                    maxZoom={10}
                    minZoom={1}
                    dragging
                    whenReady={handleWhenReady}
                    style={{ height: '100%', width: '100%' }}
                >
                    <TileLayer
                        url={getTileLayerById('satellite').url}
                        attribution="Map tiles by Carto, under CC BY 3.0. Data by OpenStreetMap, under ODbL."
                    />
                    <MapClickHandler onClick={handleMapClick} />

                    {hasLocation && (
                        <Marker position={normalizedLocation} icon={customIcon}>
                            <Popup>
                                {stationCallsignLabel
                                    ? `${stationLabel} (${stationCallsignLabel})`
                                    : stationLabel}
                            </Popup>
                        </Marker>
                    )}

                    {hasLocation && polylines.map((polyline, index) => (
                        <Polyline
                            key={index}
                            positions={polyline}
                            color="white"
                            opacity={0.8}
                            lineCap="round"
                            lineJoin="round"
                            dashArray="2, 2"
                            dashOffset="10"
                            interactive={false}
                            smoothFactor={1}
                            noClip={false}
                            className="leaflet-interactive"
                            weight={1}
                        />
                    ))}

                    {hasLocation && (
                        <Circle
                            center={normalizedLocation}
                            radius={400000}
                            pathOptions={{
                                color: 'white',
                                fillOpacity: 0,
                                weight: 1,
                                opacity: 0.8,
                                dashArray: '2, 2',
                            }}
                        />
                    )}
                </MapContainer>
            </Box>

            {!hasLocation && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    {t('location.map_empty_state', { defaultValue: 'No marker selected yet.' })}
                </Typography>
            )}
        </SettingsSection>
    );

    const wizardMapSection = (
        <SettingsSection
            title={t('location.map_section_title', { defaultValue: 'Map Selection' })}
            description={t('location.map_instruction', {
                defaultValue: 'Click anywhere on the map to set your station coordinates.',
            })}
            sx={locationCardSx}
        >
            <Box
                sx={{
                    position: 'relative',
                    width: '100%',
                    height: { xs: 420, sm: 460, md: 520 },
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 1,
                    overflow: 'hidden',
                }}
            >
                <MapContainer
                    center={mapCenter}
                    zoom={mapZoom}
                    maxZoom={10}
                    minZoom={1}
                    dragging
                    whenReady={handleWhenReady}
                    style={{ height: '100%', width: '100%' }}
                >
                    <TileLayer
                        url={getTileLayerById('satellite').url}
                        attribution="Map tiles by Carto, under CC BY 3.0. Data by OpenStreetMap, under ODbL."
                    />
                    <MapClickHandler onClick={handleMapClick} />

                    {hasLocation && (
                        <Marker position={normalizedLocation} icon={customIcon}>
                            <Popup>
                                {stationCallsignLabel
                                    ? `${stationLabel} (${stationCallsignLabel})`
                                    : stationLabel}
                            </Popup>
                        </Marker>
                    )}

                    {hasLocation && polylines.map((polyline, index) => (
                        <Polyline
                            key={index}
                            positions={polyline}
                            color="white"
                            opacity={0.8}
                            lineCap="round"
                            lineJoin="round"
                            dashArray="2, 2"
                            dashOffset="10"
                            interactive={false}
                            smoothFactor={1}
                            noClip={false}
                            className="leaflet-interactive"
                            weight={1}
                        />
                    ))}

                    {hasLocation && (
                        <Circle
                            center={normalizedLocation}
                            radius={400000}
                            pathOptions={{
                                color: 'white',
                                fillOpacity: 0,
                                weight: 1,
                                opacity: 0.8,
                                dashArray: '2, 2',
                            }}
                        />
                    )}
                </MapContainer>

                <Box
                    sx={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        zIndex: 500,
                        pointerEvents: 'none',
                        width: { xs: 'calc(100% - 24px)', sm: 320 },
                    }}
                >
                    <Box
                        sx={{
                            p: 1.25,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            boxShadow: 3,
                            backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.86),
                            backdropFilter: 'blur(8px)',
                        }}
                    >
                        <Stack spacing={0.9}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                    {t('location.station_summary', { defaultValue: 'Station' })}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {statusLabel}
                                </Typography>
                            </Stack>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                {stationCallsignLabel
                                    ? `${stationLabel} (${stationCallsignLabel})`
                                    : stationLabel}
                            </Typography>
                            <Grid container spacing={0.8} columns={12}>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.latitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? normalizedLocation.lat.toFixed(6) : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.longitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? normalizedLocation.lon.toFixed(6) : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.qth_locator')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? (qth || 'N/A') : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.altitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? elevationText : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={12}>
                                    <Typography variant="caption" color="text.secondary">{t('location.nearest_city')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {nearestCityText}
                                    </Typography>
                                </Grid>
                            </Grid>
                        </Stack>
                    </Box>
                </Box>

                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        right: 12,
                        zIndex: 500,
                        pointerEvents: 'none',
                    }}
                >
                    <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ pointerEvents: 'auto' }}
                        >
                            <ButtonGroup size="small" variant="contained" aria-label={t('location.actions', { defaultValue: 'Actions' })}>
                                <Button
                                    disabled={locationLoading || locationSaving}
                                    onClick={getCurrentLocation}
                                >
                                    {locationLoading
                                        ? t('location.state_locating', { defaultValue: 'Locating...' })
                                        : t('location.get_current_location')}
                                </Button>
                                <Button
                                    disabled={locationLoading || locationSaving}
                                    onClick={handleOpenManualCoordinatesDialog}
                                >
                                    {t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                                </Button>
                            </ButtonGroup>
                            <ButtonGroup size="small" variant="outlined" aria-label={t('location.actions', { defaultValue: 'Actions' })}>
                                <Button disabled={!hasLocation} onClick={handleCopyCoordinates}>
                                    {t('location.copy_coordinates')}
                                </Button>
                                <Button
                                    disabled={!hasLocation}
                                    onClick={() => {
                                        if (hasLocation) reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
                                    }}
                                >
                                    {t('location.map_recenter', { defaultValue: 'Recenter' })}
                                </Button>
                            </ButtonGroup>
                        </Stack>
                        {!hasLocation && (
                            <Typography
                                variant="caption"
                                sx={{
                                    px: 1.25,
                                    py: 0.5,
                                    borderRadius: 1,
                                    color: 'warning.dark',
                                    backgroundColor: (theme) => alpha(theme.palette.warning.light, 0.85),
                                    pointerEvents: 'none',
                                }}
                            >
                                {t('location.map_empty_hint', { defaultValue: 'No location selected yet. Click the map or use current location.' })}
                            </Typography>
                        )}
                    </Stack>
                </Box>
            </Box>
        </SettingsSection>
    );

    const wizardReviewSection = (
        <SettingsSection
            title={t('location.wizard_review_title', { defaultValue: 'Review Configuration' })}
            description={t('location.wizard_review_help', {
                defaultValue: 'Verify station identity and coordinates, then save to continue.',
            })}
            sx={locationCardSx}
        >
            <Grid container spacing={2} columns={12}>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">{t('location.station_name', { defaultValue: 'Station Name' })}</Typography>
                    <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {normalizeStationName(stationName) || 'home'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">{t('location.ham_callsign', { defaultValue: 'HAM Callsign' })}</Typography>
                    <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {stationCallsignLabel || t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                    </Typography>
                </Grid>
            </Grid>
        </SettingsSection>
    );

    const wizardReviewContent = (
        <Grid container spacing={2} columns={12} alignItems="stretch">
            <Grid
                size={{ xs: 12, md: 5 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {wizardReviewSection}
            </Grid>
            <Grid
                size={{ xs: 12, md: 7 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {stationCoordinatesSection}
            </Grid>
        </Grid>
    );

    const defaultLocationContent = (
        <>
            <Grid container spacing={2} columns={{ xs: 1, sm: 1, md: 1, lg: 2 }}>
                <Grid size={{ xs: 1, md: 1 }}>
                    <Stack spacing={2}>
                        {stationIdentitySection}
                        {stationCoordinatesSection}
                        {stationActionsSection}
                    </Stack>
                </Grid>
                <Grid size={{ xs: 1, md: 1 }}>
                    {mapSection}
                </Grid>
            </Grid>

            <SettingsActionFooter
                statusText={statusLabel}
                sticky
                mobileInline
                sx={{
                    backgroundColor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.grey[700], 0.18)
                            : alpha(theme.palette.grey[100], 0.9)
                    ),
                }}
            >
                <Button
                    variant="outlined"
                    disabled={!canReset}
                    onClick={handleResetLocation}
                >
                    {t('location.reset', { defaultValue: 'Reset' })}
                </Button>
                <Button
                    variant="contained"
                    disabled={!canSave || !isDifferentFromSaved}
                    aria-label={t('location.save_location')}
                    onClick={handleSetLocation}
                >
                    {locationSaving
                        ? t('location.state_saving', { defaultValue: 'Saving...' })
                        : t('location.save_location', { defaultValue: 'Save location' })}
                </Button>
            </SettingsActionFooter>
        </>
    );

    const wizardLocationContent = (
        <>
            <Box sx={{ px: { xs: 0, sm: 1 } }}>
                <Stepper activeStep={wizardStep} alternativeLabel>
                    {wizardSteps.map((label) => (
                        <Step key={label}>
                            <StepLabel>{label}</StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Box>

            {wizardStep === WIZARD_STEP_IDENTITY && (
                <Stack spacing={2}>
                    {stationIdentitySection}
                </Stack>
            )}

            {wizardStep === WIZARD_STEP_COORDINATES && (
                <Stack spacing={2}>
                    {wizardMapSection}
                </Stack>
            )}

            {wizardStep === WIZARD_STEP_REVIEW && (
                <Stack spacing={2}>
                    {wizardReviewContent}
                </Stack>
            )}

            <SettingsActionFooter
                statusText={statusLabel}
                mobileInline
                sx={{
                    backgroundColor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.grey[700], 0.18)
                            : alpha(theme.palette.grey[100], 0.9)
                    ),
                }}
            >
                <Button
                    variant="outlined"
                    onClick={handleWizardBack}
                    disabled={wizardStep === WIZARD_STEP_IDENTITY || locationSaving}
                >
                    {t('location.back', { defaultValue: 'Back' })}
                </Button>
                {isWizardLastStep ? (
                    <Button
                        variant="contained"
                        disabled={!canSave || !isDifferentFromSaved}
                        aria-label={t('location.save_location')}
                        onClick={handleWizardSave}
                    >
                        {locationSaving
                            ? t('location.state_saving', { defaultValue: 'Saving...' })
                            : t('location.finish_setup', { defaultValue: 'Save and Continue' })}
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        onClick={handleWizardNext}
                        disabled={!canAdvanceWizard || locationSaving}
                    >
                        {t('location.next', { defaultValue: 'Next' })}
                    </Button>
                )}
            </SettingsActionFooter>
        </>
    );

    return (
        <SettingsSurface
            elevation={wizardMode ? 0 : 3}
            sx={wizardMode
                ? { p: 0, bgcolor: 'transparent', boxShadow: 'none' }
                : undefined}
        >
            <Stack spacing={2}>
                <SettingsSurfaceHeader
                    title={wizardMode
                        ? t('location.wizard_title', { defaultValue: 'Ground Station Setup Wizard' })
                        : t('location.ground_station_location', { defaultValue: 'Ground Station Location' })}
                    subtitle={wizardMode
                        ? t('location.wizard_subtitle', {
                            defaultValue: 'Complete these steps to configure your first ground station.',
                        })
                        : t('location.subtitle', {
                            defaultValue: 'Set station coordinates by map selection or geolocation, then save to backend.',
                        })}
                    status={{ label: statusLabel, color: statusColor }}
                />

                {wizardMode ? wizardLocationContent : defaultLocationContent}
            </Stack>

            <Dialog
                open={manualDialogOpen}
                onClose={handleCloseManualCoordinatesDialog}
                fullWidth
                maxWidth="xs"
                PaperProps={{
                    component: 'form',
                    onSubmit: (event) => {
                        event.preventDefault();
                        handleApplyManualCoordinates();
                    },
                }}
            >
                <DialogTitle>
                    {t('location.manual_coordinates_title', { defaultValue: 'Set Coordinates Manually' })}
                </DialogTitle>
                <DialogContent sx={{ pt: '20px !important' }}>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            label={t('location.latitude')}
                            type="number"
                            value={manualLatInput}
                            onChange={(event) => {
                                setManualLatInput(event.target.value);
                                if (manualInputError) {
                                    setManualInputError('');
                                }
                            }}
                            inputProps={{ min: -90, max: 90, step: 'any' }}
                            autoFocus
                            fullWidth
                        />
                        <TextField
                            label={t('location.longitude')}
                            type="number"
                            value={manualLonInput}
                            onChange={(event) => {
                                setManualLonInput(event.target.value);
                                if (manualInputError) {
                                    setManualInputError('');
                                }
                            }}
                            inputProps={{ min: -180, max: 180, step: 'any' }}
                            fullWidth
                        />
                        <Typography variant="caption" color={manualInputError ? 'error.main' : 'text.secondary'}>
                            {manualInputError || t('location.manual_coordinates_hint', {
                                defaultValue: 'Use decimal degrees. Example: 37.9838, 23.7275',
                            })}
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseManualCoordinatesDialog}>
                        {t('location.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button type="submit" variant="contained">
                        {t('location.apply_coordinates', { defaultValue: 'Apply Coordinates' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </SettingsSurface>
    );
};

export default LocationPage;
