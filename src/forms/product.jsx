import React from 'react'
import PropTypes from 'prop-types'
import { ReactiveComponent } from 'oo7-react'
import FormBuilder, { fillValues } from '../components/FormBuilder'

export default class Product extends ReactiveComponent {
    constructor(props) {
        super(props)

        this.state = {
            inputs: [
                {
                    name: 'id',
                    hidden: true,
                },
                {
                    label: 'Title',
                    minLength: 6,
                    maxLength: 64,
                    name: 'title',
                    placeholder: 'Enter product title',
                    required: true,
                    type: 'text',
                    validate: props.validateTitle,
                    value: '',
                },
                {
                    label: 'Price',
                    min: 0,
                    max: 1000,
                    name: 'price',
                    placeholder: 'Enter product price',
                    required: true,
                    type: 'number',
                    value: '',
                },
                {
                    label: 'Category',
                    name: 'category',
                    options: [
                        {
                            label: 'Clothes',
                            value: 'clothes'
                        },
                        {
                            label: 'Home',
                            value: 'home'
                        }
                    ],
                    radio: true,
                    required: true,
                    type: 'checkbox-group'
                }
            ]
        }
    }

    componentWillMount() {
        const { inputs } = this.state
        const { values } = this.props
        fillValues(inputs, values)
        this.setState({ inputs })
    }

    render() {
        return <FormBuilder {...{ ...this.props, ...this.state }} />
    }
}
Product.propTypes = {
    validateTitle: PropTypes.func.isRequired,
    value: PropTypes.shape({
        id: PropTypes.number.isRequired,
        title: PropTypes.string.isRequired,
        price: PropTypes.number.isRequired,
        category: PropTypes.string.isRequired,
    })
}
Product.defaultProps = {
    header: 'Create Product',
    size: 'tiny',
}