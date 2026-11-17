enum WindDigitOrder {
    //% block="左端がDS1"
    DS1Left,
    //% block="左端がDS4"
    DS4Left
}

//% color=#276F68 icon="\uf0e7" block="風車電力計"
namespace windMeter {
    const address = 0x48
    const config = 0xC583 // AIN0/GND, ±2.048 V, single shot, 128 SPS
    const digits = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111]
    let order = WindDigitOrder.DS1Left
    let running = false

    function display(glyphs: number[]) {
        for (let stage = 3; stage >= 0; stage--) {
            let index = order == WindDigitOrder.DS1Left ? stage : 3 - stage
            let value = 255 ^ glyphs[index]
            for (let bit = 7; bit >= 0; bit--) {
                pins.digitalWritePin(DigitalPin.P15, (value >> bit) & 1)
                pins.digitalWritePin(DigitalPin.P13, 1)
                pins.digitalWritePin(DigitalPin.P13, 0)
            }
        }
        pins.digitalWritePin(DigitalPin.P16, 1)
        pins.digitalWritePin(DigitalPin.P16, 0)
    }

    // common I2C read function
    function readAdcRaw(): number {
        let request = pins.createBuffer(3)
        request[0] = 1
        request[1] = config >> 8
        request[2] = config & 255
        pins.i2cWriteBuffer(address, request)
        basic.pause(12)
        pins.i2cWriteNumber(address, 1, NumberFormat.UInt8BE, true)
        if (pins.i2cReadNumber(address, NumberFormat.UInt16BE) != config) {
            return -999 // Err
        }
        pins.i2cWriteNumber(address, 0, NumberFormat.UInt8BE, true)
        return pins.i2cReadNumber(address, NumberFormat.Int16BE)
    }

    // --- 1. 電流（mA）測定ロジック（小数第1位まで表示: 例 12.5 mA） ---
    function updateCurrent() {
        let raw = readAdcRaw()
        if (raw == -999) { display([0, 121, 80, 80]); return; } // Err
        if (raw == 32767) { display([0, 0, 118, 6]); return; }  // HI

        let tenths = Math.round(Math.max(0, raw) * 0.01875)
        let tens = Math.idiv(tenths, 100)
        display([
            0,
            tens ? digits[tens] : 0,
            digits[Math.idiv(tenths, 10) % 10] | 128, // 小数点
            digits[tenths % 10]
        ])
    }

    // --- 2. 電圧（V）測定ロジック（小数第2位まで表示: 例 1.25 V） ---
    function updateVoltage() {
        let raw = readAdcRaw()
        if (raw == -999) { display([0, 121, 80, 80]); return; } // Err
        if (raw == 32767) { display([0, 0, 118, 6]); return; }  // HI

        // 電圧(mV)を算出し、X.XX V表示用に調整
        let voltageMv = Math.max(0, raw) * 0.1875
        let vVal = Math.round(voltageMv / 10) // 例: 1250mV -> 125
        let d1 = Math.idiv(vVal, 100) % 10
        let d2 = Math.idiv(vVal, 10) % 10
        let d3 = vVal % 10

        display([
            0,
            digits[d1] | 128, // 1の位に小数点をつけて「X.」にする
            digits[d2],
            digits[d3]
        ])
    }

    // --- 3. 電力（mW）測定ロジック（整数で表示: 例 125 mW） ---
    function updatePower() {
        let raw = readAdcRaw()
        if (raw == -999) { display([0, 121, 80, 80]); return; } // Err
        if (raw == 32767) { display([0, 0, 118, 6]); return; }  // HI

        let voltageMv = Math.max(0, raw) * 0.1875
        // P = V^2 / R (R=100Ω), mW単位に変換
        let powerMw = Math.round((voltageMv * voltageMv) / 100000)
        let displayVal = Math.min(9999, powerMw)

        let d0 = Math.idiv(displayVal, 1000) % 10
        let d1 = Math.idiv(displayVal, 100) % 10
        let d2 = Math.idiv(displayVal, 10) % 10
        let d3 = displayVal % 10

        display([
            d0 ? digits[d0] : 0,
            d1 ? digits[d1] : 0,
            digits[d2],
            digits[d3]
        ])
    }

    /** 100Ωの負荷電流を起動直後から2秒ごとに表示する。 */
    //% blockId=wind_meter_start_current block="100Ωの電流を2秒ごとに表示する %direction"
    export function start(direction: WindDigitOrder) {
        order = direction
        if (running) return
        running = true
        pins.digitalWritePin(DigitalPin.P8, 1)
        pins.digitalWritePin(DigitalPin.P13, 0)
        pins.digitalWritePin(DigitalPin.P16, 0)
        display([0, 0, 0, 0])
        pins.digitalWritePin(DigitalPin.P8, 0)
        control.inBackground(function () {
            while (true) {
                let startTime = input.runningTime()
                updateCurrent()
                basic.pause(Math.max(1, 2000 - (input.runningTime() - startTime)))
            }
        })
    }
